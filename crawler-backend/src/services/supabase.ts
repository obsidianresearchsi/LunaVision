import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface CrawledFace {
    faceToken: string;
    name: string;
    imageUrl: string;
    originalImageUrl: string; // Original URL where image was found
    sourceUrl: string; // Page URL where image was found
    sourceDomain: string;
    coordinates?: { lat: number; lng: number };
    metadata?: Record<string, any>;
    crawledAt: string;
}

class SupabaseService {
    private client: SupabaseClient;

    constructor() {
        this.client = createClient(config.supabase.url, config.supabase.serviceKey);
    }

    async uploadImage(faceToken: string, imageBuffer: Buffer, mimeType: string): Promise<string> {
        const extension = mimeType.includes('png') ? 'png' : 'jpg';
        const filePath = `${faceToken}.${extension}`;

        const { error } = await this.client.storage
            .from('mugshots')
            .upload(filePath, imageBuffer, {
                contentType: mimeType,
                upsert: true,
            });

        if (error) {
            logger.error('Failed to upload image to Supabase Storage', { error: error.message });
            throw new Error(`Storage upload failed: ${error.message}`);
        }

        const { data: urlData } = this.client.storage
            .from('mugshots')
            .getPublicUrl(filePath);

        return urlData.publicUrl;
    }

    async saveCrawledFace(face: CrawledFace): Promise<void> {
        const { error } = await this.client
            .from('suspects')
            .upsert({
                face_token: face.faceToken,
                name: face.name,
                crime: 'Pending Investigation',
                nin: 'N/A',
                location: face.sourceDomain,
                image_url: face.imageUrl,
                source_url: face.sourceUrl,
                original_image_url: face.originalImageUrl, // Store original image URL
                coordinates_lat: face.coordinates?.lat || null,
                coordinates_lng: face.coordinates?.lng || null,
                status: null, // Will be set when identified
            }, {
                onConflict: 'face_token',
            });

        if (error) {
            logger.error('Failed to save crawled face', { error: error.message });
            throw new Error(`Database save failed: ${error.message}`);
        }
    }

    async getCrawlStats(): Promise<{ total: number; today: number; sources: number }> {
        const { count: total, error: totalError } = await this.client
            .from('suspects')
            .select('*', { count: 'exact', head: true });

        if (totalError) {
            logger.error('Failed to get total count', { error: totalError.message });
        }

        const { data: sources, error: sourcesError } = await this.client
            .from('suspects')
            .select('source_url');

        if (sourcesError) {
            logger.error('Failed to get sources', { error: sourcesError.message });
        }

        // Safely parse URLs and count unique domains (crawled sources only)
        const uniqueSources = new Set<string>();
        let crawledCount = 0;
        if (sources) {
            for (const s of sources) {
                if (s.source_url && s.source_url !== 'police_db' && s.source_url !== 'Manual Enrollment') {
                    crawledCount++;
                    try {
                        uniqueSources.add(new URL(s.source_url).hostname);
                    } catch {
                        // Invalid URL, skip it
                    }
                }
            }
        }

        return {
            total: total || 0,
            today: crawledCount, // Show crawled faces count instead (no created_at column)
            sources: uniqueSources.size,
        };
    }

    async checkFaceExists(faceToken: string): Promise<boolean> {
        const { data } = await this.client
            .from('suspects')
            .select('face_token')
            .eq('face_token', faceToken)
            .single();

        return !!data;
    }
}

export const supabaseService = new SupabaseService();
