import dotenv from 'dotenv';
dotenv.config();

export const config = {
    supabase: {
        url: process.env.SUPABASE_URL || '',
        serviceKey: process.env.SUPABASE_SERVICE_KEY || '',
    },
    facepp: {
        apiKey: process.env.FACEPP_API_KEY || '',
        apiSecret: process.env.FACEPP_API_SECRET || '',
        facesetToken: process.env.FACEPP_FACESET_TOKEN || 'eagleeye_db',
        baseUrl: 'https://api-us.faceplusplus.com/facepp/v3',
    },
    crawler: {
        concurrency: parseInt(process.env.CRAWLER_CONCURRENCY || '5'),
        delayMs: parseInt(process.env.CRAWLER_DELAY_MS || '1000'),
        maxDepth: parseInt(process.env.CRAWLER_MAX_DEPTH || '3'),
        maxImagesPerPage: parseInt(process.env.CRAWLER_MAX_IMAGES_PER_PAGE || '50'),
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    server: {
        port: parseInt(process.env.PORT || '3001'),
        nodeEnv: process.env.NODE_ENV || 'development',
    },
};
