import axios from 'axios';
import * as cheerio from 'cheerio';
import PQueue from 'p-queue';
import { URL } from 'url';
import { config } from '../config';
import { logger } from '../utils/logger';
import { imageProcessor } from '../services/imageProcessor';
import { facePlusPlusService } from '../services/facepp';
import { supabaseService, CrawledFace } from '../services/supabase';
import { EventEmitter } from 'events';

export interface CrawlJob {
    id: string;
    urls: string[];
    status: 'pending' | 'running' | 'completed' | 'stopped' | 'error';
    stats: CrawlStats;
    startedAt?: Date;
    completedAt?: Date;
}

export interface CrawlStats {
    pagesScanned: number;
    imagesFound: number;
    facesDetected: number;
    facesIndexed: number;
    errors: number;
    currentUrl?: string;
}

export class WebCrawler extends EventEmitter {
    private queue: PQueue;
    private visitedUrls: Set<string> = new Set();
    private isRunning: boolean = false;
    private currentJob: CrawlJob | null = null;

    constructor() {
        super();
        this.queue = new PQueue({ 
            concurrency: config.crawler.concurrency,
            interval: config.crawler.delayMs,
            intervalCap: 1,
        });
    }

    async startCrawl(jobId: string, seedUrls: string[]): Promise<CrawlJob> {
        if (this.isRunning) {
            throw new Error('Crawler is already running');
        }

        this.isRunning = true;
        this.visitedUrls.clear();

        this.currentJob = {
            id: jobId,
            urls: seedUrls,
            status: 'running',
            stats: {
                pagesScanned: 0,
                imagesFound: 0,
                facesDetected: 0,
                facesIndexed: 0,
                errors: 0,
            },
            startedAt: new Date(),
        };

        // Ensure faceset exists
        try {
            await facePlusPlusService.ensureFaceset();
        } catch (error) {
            logger.error('Failed to initialize faceset', { error });
        }

        // Start crawling each seed URL
        for (const url of seedUrls) {
            if (!this.isRunning) break;
            this.queue.add(() => this.crawlPage(url, 0));
        }

        // Wait for queue to complete
        await this.queue.onIdle();

        this.currentJob.status = this.isRunning ? 'completed' : 'stopped';
        this.currentJob.completedAt = new Date();
        this.isRunning = false;

        this.emit('completed', this.currentJob);
        return this.currentJob;
    }

    stopCrawl(): void {
        this.isRunning = false;
        this.queue.clear();
        if (this.currentJob) {
            this.currentJob.status = 'stopped';
        }
        this.emit('stopped', this.currentJob);
    }

    getStatus(): CrawlJob | null {
        return this.currentJob;
    }

    private async crawlPage(url: string, depth: number): Promise<void> {
        if (!this.isRunning) return;
        if (depth > config.crawler.maxDepth) return;
        if (this.visitedUrls.has(url)) return;

        this.visitedUrls.add(url);

        try {
            const parsedUrl = new URL(url);
            const domain = parsedUrl.hostname;

            logger.info(`Crawling: ${url}`, { depth });
            this.updateStats({ currentUrl: url });

            // Fetch page HTML
            const response = await axios.get(url, {
                timeout: 15000,
                headers: {
                    'User-Agent': config.crawler.userAgent,
                    'Accept': 'text/html,application/xhtml+xml',
                },
                maxContentLength: 5 * 1024 * 1024, // 5MB max
            });

            const $ = cheerio.load(response.data);
            this.updateStats({ pagesScanned: (this.currentJob?.stats.pagesScanned || 0) + 1 });

            // Extract all images
            const imageUrls: string[] = [];
            $('img').each((_, el) => {
                const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
                if (src) {
                    try {
                        const absoluteUrl = new URL(src, url).href;
                        if (imageProcessor.isLikelyFaceImage(absoluteUrl)) {
                            imageUrls.push(absoluteUrl);
                        }
                    } catch {}
                }
            });

            // Also check for background images in style attributes
            $('[style*="background"]').each((_, el) => {
                const style = $(el).attr('style') || '';
                const match = style.match(/url\(['"]?([^'")\s]+)['"]?\)/);
                if (match && match[1]) {
                    try {
                        const absoluteUrl = new URL(match[1], url).href;
                        if (imageProcessor.isLikelyFaceImage(absoluteUrl)) {
                            imageUrls.push(absoluteUrl);
                        }
                    } catch {}
                }
            });

            // Limit images per page
            const limitedImages = imageUrls.slice(0, config.crawler.maxImagesPerPage);
            this.updateStats({ imagesFound: (this.currentJob?.stats.imagesFound || 0) + limitedImages.length });

            logger.info(`Found ${limitedImages.length} potential face images on ${url}`);

            // Process each image
            for (const imgUrl of limitedImages) {
                if (!this.isRunning) break;
                await this.processImage(imgUrl, url, domain);
            }

            // Extract links for deeper crawling
            if (depth < config.crawler.maxDepth) {
                const links: string[] = [];
                $('a[href]').each((_, el) => {
                    const href = $(el).attr('href');
                    if (href) {
                        try {
                            const absoluteUrl = new URL(href, url).href;
                            const linkDomain = new URL(absoluteUrl).hostname;
                            // Stay on same domain
                            if (linkDomain === domain && !this.visitedUrls.has(absoluteUrl)) {
                                links.push(absoluteUrl);
                            }
                        } catch {}
                    }
                });

                // Queue discovered links
                const uniqueLinks = [...new Set(links)].slice(0, 20); // Limit links per page
                for (const link of uniqueLinks) {
                    this.queue.add(() => this.crawlPage(link, depth + 1));
                }
            }

        } catch (error: any) {
            logger.error(`Failed to crawl ${url}`, { error: error.message });
            this.updateStats({ errors: (this.currentJob?.stats.errors || 0) + 1 });
        }
    }

    private async processImage(imageUrl: string, sourceUrl: string, domain: string): Promise<void> {
        try {
            // Download image
            const imageBuffer = await imageProcessor.downloadImage(imageUrl);
            if (!imageBuffer) return;

            // Process/resize image
            const processed = await imageProcessor.processImage(imageBuffer);
            if (!processed) return;

            // Detect face
            const faceResult = await facePlusPlusService.detectFace(processed.buffer);
            if (!faceResult) {
                logger.debug('No face detected in image', { imageUrl });
                return;
            }

            this.updateStats({ facesDetected: (this.currentJob?.stats.facesDetected || 0) + 1 });
            logger.info(`Face detected!`, { faceToken: faceResult.faceToken.slice(0, 8), imageUrl });

            // Check if already indexed
            const exists = await supabaseService.checkFaceExists(faceResult.faceToken);
            if (exists) {
                logger.debug('Face already indexed', { faceToken: faceResult.faceToken.slice(0, 8) });
                return;
            }

            // Add to Face++ faceset (required for search to work)
            try {
                await facePlusPlusService.addToFaceset(faceResult.faceToken);
                logger.info('Added to faceset', { faceToken: faceResult.faceToken.slice(0, 8) });
            } catch (facesetError: any) {
                logger.error('Failed to add to faceset - face will not be searchable', { 
                    error: facesetError.message,
                    faceToken: faceResult.faceToken.slice(0, 8)
                });
                this.updateStats({ errors: (this.currentJob?.stats.errors || 0) + 1 });
                // Still save to database but mark that it's not indexed in Face++
            }

            // Upload to Supabase Storage
            let storageUrl: string;
            try {
                storageUrl = await supabaseService.uploadImage(
                    faceResult.faceToken,
                    processed.buffer,
                    processed.mimeType
                );
                logger.info('Uploaded to storage', { faceToken: faceResult.faceToken.slice(0, 8) });
            } catch (uploadError: any) {
                logger.error('Failed to upload to storage', { error: uploadError.message });
                this.updateStats({ errors: (this.currentJob?.stats.errors || 0) + 1 });
                return;
            }

            // Generate random coordinates within Nigeria
            const coordinates = {
                lat: 6.5 + (Math.random() * 7), // 6.5 to 13.5
                lng: 3.0 + (Math.random() * 11), // 3 to 14
            };

            // Save to database
            const crawledFace: CrawledFace = {
                faceToken: faceResult.faceToken,
                name: `Unknown (${domain})`,
                imageUrl: storageUrl,
                originalImageUrl: imageUrl, // Store the original image URL
                sourceUrl: sourceUrl,
                sourceDomain: domain,
                coordinates,
                metadata: faceResult.attributes,
                crawledAt: new Date().toISOString(),
            };

            try {
                await supabaseService.saveCrawledFace(crawledFace);
                logger.info('Saved to database', { faceToken: faceResult.faceToken.slice(0, 8) });
            } catch (dbError: any) {
                logger.error('Failed to save to database', { error: dbError.message });
                this.updateStats({ errors: (this.currentJob?.stats.errors || 0) + 1 });
                return;
            }

            this.updateStats({ facesIndexed: (this.currentJob?.stats.facesIndexed || 0) + 1 });
            logger.info(`Face indexed successfully`, { 
                faceToken: faceResult.faceToken.slice(0, 8),
                domain,
                total: this.currentJob?.stats.facesIndexed 
            });

            this.emit('faceIndexed', crawledFace);

        } catch (error: any) {
            logger.error('Failed to process image', { imageUrl, error: error.message });
            this.updateStats({ errors: (this.currentJob?.stats.errors || 0) + 1 });
        }
    }

    private updateStats(update: Partial<CrawlStats>): void {
        if (this.currentJob) {
            this.currentJob.stats = { ...this.currentJob.stats, ...update };
            this.emit('statsUpdate', this.currentJob.stats);
        }
    }
}

export const webCrawler = new WebCrawler();
