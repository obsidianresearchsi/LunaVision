import sharp from 'sharp';
import axios from 'axios';
import { logger } from '../utils/logger';

export interface ProcessedImage {
    buffer: Buffer;
    mimeType: string;
    width: number;
    height: number;
}

class ImageProcessor {
    private readonly maxWidth = 800;
    private readonly maxHeight = 800;
    private readonly quality = 85;

    async downloadImage(url: string): Promise<Buffer | null> {
        try {
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'image/*',
                },
                maxContentLength: 10 * 1024 * 1024, // 10MB max
            });

            return Buffer.from(response.data);
        } catch (error: any) {
            logger.debug('Failed to download image', { url, error: error.message });
            return null;
        }
    }

    async processImage(buffer: Buffer): Promise<ProcessedImage | null> {
        try {
            const metadata = await sharp(buffer).metadata();

            if (!metadata.width || !metadata.height) {
                return null;
            }

            // Skip very small images (likely icons/thumbnails)
            if (metadata.width < 100 || metadata.height < 100) {
                return null;
            }

            // Skip very large aspect ratios (likely banners)
            const aspectRatio = metadata.width / metadata.height;
            if (aspectRatio > 3 || aspectRatio < 0.33) {
                return null;
            }

            // Resize and compress
            const processed = await sharp(buffer)
                .resize(this.maxWidth, this.maxHeight, {
                    fit: 'inside',
                    withoutEnlargement: true,
                })
                .jpeg({ quality: this.quality })
                .toBuffer();

            const newMetadata = await sharp(processed).metadata();

            return {
                buffer: processed,
                mimeType: 'image/jpeg',
                width: newMetadata.width || 0,
                height: newMetadata.height || 0,
            };
        } catch (error: any) {
            logger.debug('Failed to process image', { error: error.message });
            return null;
        }
    }

    isLikelyFaceImage(url: string): boolean {
        const lowerUrl = url.toLowerCase();
        
        // Skip obvious non-face images
        const skipPatterns = [
            'logo', 'icon', 'sprite', 'bg-', 'pattern',
            'share', 'arrow', 'chevron', 'button',
            '.svg', '.gif', 'data:image', '1x1', 'pixel',
            'tracking', 'analytics', 'beacon',
        ];

        for (const pattern of skipPatterns) {
            if (lowerUrl.includes(pattern)) {
                return false;
            }
        }

        // Accept images with common photo extensions - be more permissive
        // Face++ will filter out non-face images anyway
        return /\.(jpg|jpeg|png|webp)(\?|$)/i.test(url);
    }
}

export const imageProcessor = new ImageProcessor();
