import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { webCrawler } from '../crawler/WebCrawler';
import { socialMediaCrawler } from '../crawler/SocialMediaCrawler';
import { supabaseService } from '../services/supabase';
import { logger } from '../utils/logger';

const router = Router();

// Start web crawl
router.post('/start', async (req: Request, res: Response) => {
    try {
        const { urls } = req.body;

        if (!urls || !Array.isArray(urls) || urls.length === 0) {
            return res.status(400).json({ error: 'URLs array is required' });
        }

        const jobId = uuidv4();
        logger.info('Starting crawl job', { jobId, urlCount: urls.length });

        // Start crawl in background
        webCrawler.startCrawl(jobId, urls).catch(err => {
            logger.error('Crawl job failed', { jobId, error: err.message });
        });

        res.json({ 
            success: true, 
            jobId,
            message: 'Crawl started',
        });
    } catch (error: any) {
        logger.error('Failed to start crawl', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// Stop crawl
router.post('/stop', (req: Request, res: Response) => {
    webCrawler.stopCrawl();
    res.json({ success: true, message: 'Crawl stopped' });
});

// Get crawl status
router.get('/status', (req: Request, res: Response) => {
    const status = webCrawler.getStatus();
    res.json(status || { status: 'idle' });
});


// Start social media crawl
router.post('/social', async (req: Request, res: Response) => {
    try {
        const { platform, searchTerms, maxProfiles = 50, maxImagesPerProfile = 20 } = req.body;

        if (!platform || !searchTerms || !Array.isArray(searchTerms)) {
            return res.status(400).json({ 
                error: 'platform and searchTerms array are required' 
            });
        }

        const validPlatforms = ['facebook', 'instagram', 'twitter', 'linkedin', 'tiktok'];
        if (!validPlatforms.includes(platform)) {
            return res.status(400).json({ 
                error: `Invalid platform. Must be one of: ${validPlatforms.join(', ')}` 
            });
        }

        logger.info('Starting social media crawl', { platform, terms: searchTerms.length });

        // Start in background
        socialMediaCrawler.crawlPublicProfiles({
            platform,
            searchTerms,
            maxProfiles,
            maxImagesPerProfile,
        }).catch(err => {
            logger.error('Social crawl failed', { error: err.message });
        });

        res.json({ 
            success: true, 
            message: `Social media crawl started for ${platform}`,
        });
    } catch (error: any) {
        logger.error('Failed to start social crawl', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// Get database stats
router.get('/stats', async (req: Request, res: Response) => {
    try {
        const stats = await supabaseService.getCrawlStats();
        res.json(stats);
    } catch (error: any) {
        logger.error('Failed to get stats', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// Bulk URL submission
router.post('/bulk', async (req: Request, res: Response) => {
    try {
        const { urls, category } = req.body;

        if (!urls || !Array.isArray(urls)) {
            return res.status(400).json({ error: 'URLs array is required' });
        }

        // Filter and validate URLs
        const validUrls = urls.filter(url => {
            try {
                new URL(url);
                return true;
            } catch {
                return false;
            }
        });

        const jobId = uuidv4();
        logger.info('Starting bulk crawl', { jobId, urlCount: validUrls.length, category });

        webCrawler.startCrawl(jobId, validUrls).catch(err => {
            logger.error('Bulk crawl failed', { jobId, error: err.message });
        });

        res.json({ 
            success: true, 
            jobId,
            accepted: validUrls.length,
            rejected: urls.length - validUrls.length,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
