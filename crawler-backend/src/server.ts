import express from 'express';
import cors from 'cors';
import { config } from './config';
import { logger } from './utils/logger';
import crawlerRoutes from './routes/crawler';
import { webCrawler } from './crawler/WebCrawler';

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
    logger.debug(`${req.method} ${req.path}`, { 
        query: req.query, 
        body: req.method === 'POST' ? req.body : undefined 
    });
    next();
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/crawler', crawlerRoutes);

// SSE endpoint for real-time updates
app.get('/api/crawler/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (event: string, data: any) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Send initial status
    sendEvent('status', webCrawler.getStatus() || { status: 'idle' });

    // Listen for updates
    const onStats = (stats: any) => sendEvent('stats', stats);
    const onFace = (face: any) => sendEvent('faceIndexed', face);
    const onComplete = (job: any) => sendEvent('completed', job);
    const onStopped = (job: any) => sendEvent('stopped', job);

    webCrawler.on('statsUpdate', onStats);
    webCrawler.on('faceIndexed', onFace);
    webCrawler.on('completed', onComplete);
    webCrawler.on('stopped', onStopped);

    // Cleanup on disconnect
    req.on('close', () => {
        webCrawler.off('statsUpdate', onStats);
        webCrawler.off('faceIndexed', onFace);
        webCrawler.off('completed', onComplete);
        webCrawler.off('stopped', onStopped);
    });
});


// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error('Unhandled error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = config.server.port;
app.listen(PORT, () => {
    logger.info(`EagleEye Crawler Backend running on port ${PORT}`);
    logger.info(`Environment: ${config.server.nodeEnv}`);
    logger.info(`Concurrency: ${config.crawler.concurrency}`);
});

export default app;
