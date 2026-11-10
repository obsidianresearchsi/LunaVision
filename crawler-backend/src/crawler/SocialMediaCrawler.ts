import puppeteer, { Browser, Page } from 'puppeteer';
import { config } from '../config';
import { logger } from '../utils/logger';
import { imageProcessor } from '../services/imageProcessor';
import { facePlusPlusService } from '../services/facepp';
import { supabaseService, CrawledFace } from '../services/supabase';
import { EventEmitter } from 'events';

export interface SocialCrawlConfig {
    platform: 'facebook' | 'instagram' | 'twitter' | 'linkedin' | 'tiktok';
    searchTerms: string[];
    maxProfiles: number;
    maxImagesPerProfile: number;
}

export class SocialMediaCrawler extends EventEmitter {
    private browser: Browser | null = null;
    private isRunning: boolean = false;
    private facesIndexed: number = 0;

    async initialize(): Promise<void> {
        this.browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
    }

    async close(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }

    async crawlPublicProfiles(searchConfig: SocialCrawlConfig): Promise<number> {
        if (!this.browser) {
            await this.initialize();
        }

        this.isRunning = true;
        this.facesIndexed = 0;

        const page = await this.browser!.newPage();
        await page.setUserAgent(config.crawler.userAgent);

        try {
            switch (searchConfig.platform) {
                case 'facebook':
                    await this.crawlFacebookPublic(page, searchConfig);
                    break;
                case 'instagram':
                    await this.crawlInstagramPublic(page, searchConfig);
                    break;
                case 'twitter':
                    await this.crawlTwitterPublic(page, searchConfig);
                    break;
                default:
                    logger.warn(`Platform ${searchConfig.platform} not yet supported`);
            }
        } catch (error: any) {
            logger.error('Social media crawl failed', { error: error.message });
        } finally {
            await page.close();
            this.isRunning = false;
        }

        return this.facesIndexed;
    }

    private async crawlFacebookPublic(page: Page, config: SocialCrawlConfig): Promise<void> {
        // Note: Facebook has strict anti-scraping measures
        // This is a simplified example for public pages only
        for (const term of config.searchTerms) {
            if (!this.isRunning) break;

            const searchUrl = `https://www.facebook.com/search/pages/?q=${encodeURIComponent(term)}`;
            logger.info(`Searching Facebook for: ${term}`);

            try {
                await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                await this.delay(2000);

                // Scroll to load more results
                await this.autoScroll(page, 3);

                // Extract profile images
                const imageUrls = await page.evaluate(() => {
                    const images: string[] = [];
                    document.querySelectorAll('img[src*="scontent"]').forEach(img => {
                        const src = (img as HTMLImageElement).src;
                        if (src && !src.includes('emoji') && !src.includes('static')) {
                            images.push(src);
                        }
                    });
                    return images;
                });

                await this.processImages(imageUrls.slice(0, config.maxImagesPerProfile), searchUrl, 'facebook.com');
            } catch (error: any) {
                logger.error(`Facebook search failed for: ${term}`, { error: error.message });
            }
        }
    }

    private async crawlInstagramPublic(page: Page, config: SocialCrawlConfig): Promise<void> {
        for (const term of config.searchTerms) {
            if (!this.isRunning) break;

            const searchUrl = `https://www.instagram.com/explore/tags/${encodeURIComponent(term)}/`;
            logger.info(`Searching Instagram for: ${term}`);

            try {
                await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                await this.delay(2000);

                await this.autoScroll(page, 5);

                const imageUrls = await page.evaluate(() => {
                    const images: string[] = [];
                    document.querySelectorAll('img[src*="instagram"]').forEach(img => {
                        const src = (img as HTMLImageElement).src;
                        if (src && src.includes('cdninstagram')) {
                            images.push(src);
                        }
                    });
                    return images;
                });

                await this.processImages(imageUrls.slice(0, config.maxImagesPerProfile), searchUrl, 'instagram.com');
            } catch (error: any) {
                logger.error(`Instagram search failed for: ${term}`, { error: error.message });
            }
        }
    }

    private async crawlTwitterPublic(page: Page, config: SocialCrawlConfig): Promise<void> {
        for (const term of config.searchTerms) {
            if (!this.isRunning) break;

            const searchUrl = `https://twitter.com/search?q=${encodeURIComponent(term)}&f=image`;
            logger.info(`Searching Twitter for: ${term}`);

            try {
                await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                await this.delay(2000);

                await this.autoScroll(page, 5);

                const imageUrls = await page.evaluate(() => {
                    const images: string[] = [];
                    document.querySelectorAll('img[src*="pbs.twimg.com"]').forEach(img => {
                        const src = (img as HTMLImageElement).src;
                        if (src && src.includes('profile_images')) {
                            images.push(src.replace('_normal', '_400x400'));
                        }
                    });
                    return images;
                });

                await this.processImages(imageUrls.slice(0, config.maxImagesPerProfile), searchUrl, 'twitter.com');
            } catch (error: any) {
                logger.error(`Twitter search failed for: ${term}`, { error: error.message });
            }
        }
    }

    private async processImages(imageUrls: string[], sourceUrl: string, domain: string): Promise<void> {
        for (const imgUrl of imageUrls) {
            if (!this.isRunning) break;

            try {
                const imageBuffer = await imageProcessor.downloadImage(imgUrl);
                if (!imageBuffer) continue;

                const processed = await imageProcessor.processImage(imageBuffer);
                if (!processed) continue;

                const faceResult = await facePlusPlusService.detectFace(processed.buffer);
                if (!faceResult) continue;

                const exists = await supabaseService.checkFaceExists(faceResult.faceToken);
                if (exists) continue;

                await facePlusPlusService.addToFaceset(faceResult.faceToken);

                const storageUrl = await supabaseService.uploadImage(
                    faceResult.faceToken,
                    processed.buffer,
                    processed.mimeType
                );

                const crawledFace: CrawledFace = {
                    faceToken: faceResult.faceToken,
                    name: `Unknown (${domain})`,
                    imageUrl: storageUrl,
                    originalImageUrl: imgUrl,
                    sourceUrl: sourceUrl,
                    sourceDomain: domain,
                    coordinates: {
                        lat: 6.5 + (Math.random() * 7),
                        lng: 3.0 + (Math.random() * 11),
                    },
                    metadata: faceResult.attributes,
                    crawledAt: new Date().toISOString(),
                };

                await supabaseService.saveCrawledFace(crawledFace);
                this.facesIndexed++;

                logger.info(`Social media face indexed`, { 
                    faceToken: faceResult.faceToken.slice(0, 8),
                    domain,
                    total: this.facesIndexed 
                });

                this.emit('faceIndexed', crawledFace);
                await this.delay(config.crawler.delayMs);
            } catch (error: any) {
                logger.debug('Failed to process social image', { error: error.message });
            }
        }
    }

    private async autoScroll(page: Page, times: number): Promise<void> {
        for (let i = 0; i < times; i++) {
            await page.evaluate(() => window.scrollBy(0, window.innerHeight));
            await this.delay(1500);
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    stop(): void {
        this.isRunning = false;
    }
}

export const socialMediaCrawler = new SocialMediaCrawler();
