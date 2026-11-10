# EagleEye Crawler Backend

Production-grade web crawler for building a facial recognition database at scale.

## Features

- **Web Crawling**: Crawl any website using Cheerio for HTML parsing
- **Social Media**: Crawl public profiles from Facebook, Instagram, Twitter using Puppeteer
- **Face Detection**: Automatic face detection using Face++ API
- **Image Processing**: Resize, compress, and optimize images using Sharp
- **Database Storage**: Store faces in Supabase (PostgreSQL + Storage)
- **Real-time Updates**: SSE streaming for live crawl progress
- **Concurrent Processing**: Queue-based processing with configurable concurrency
- **CLI Tool**: Command-line interface for batch crawling

## Setup

1. Install dependencies:
```bash
cd crawler-backend
npm install
```

2. Copy environment file:
```bash
cp .env.example .env
```

3. Configure `.env` with your credentials:
- Supabase URL and Service Key
- Face++ API Key and Secret

4. Start the server:
```bash
npm run dev
```

## API Endpoints

### Start Web Crawl
```
POST /api/crawler/start
Body: { "urls": ["https://example.com", "https://news.com"] }
```

### Stop Crawl
```
POST /api/crawler/stop
```

### Get Status
```
GET /api/crawler/status
```

### Social Media Crawl
```
POST /api/crawler/social
Body: { 
  "platform": "instagram", 
  "searchTerms": ["lagos", "nigeria"],
  "maxProfiles": 50
}
```


### Real-time Stream
```
GET /api/crawler/stream
(Server-Sent Events)
```

### Database Stats
```
GET /api/crawler/stats
```

## CLI Usage

```bash
# Crawl specific URLs
npm run crawl -- crawl https://punchng.com https://vanguardngr.com

# Crawl social media
npm run crawl -- social instagram lagos nigeria

# Crawl pre-configured Nigerian news sites
npm run crawl -- news
```

## Architecture

```
crawler-backend/
├── src/
│   ├── config/          # Configuration
│   ├── crawler/         # Crawler engines
│   │   ├── WebCrawler.ts       # Cheerio-based web crawler
│   │   └── SocialMediaCrawler.ts # Puppeteer-based social crawler
│   ├── services/        # External services
│   │   ├── facepp.ts    # Face++ API integration
│   │   ├── supabase.ts  # Supabase database/storage
│   │   └── imageProcessor.ts # Image processing
│   ├── routes/          # API routes
│   ├── utils/           # Utilities
│   ├── server.ts        # Express server
│   └── cli.ts           # CLI tool
```

## Scaling for Millions of Images

For production scale (millions of images):

1. **Distributed Crawling**: Deploy multiple crawler instances
2. **Message Queue**: Use Redis/RabbitMQ for job distribution
3. **Rate Limiting**: Respect robots.txt and implement delays
4. **Proxy Rotation**: Use rotating proxies to avoid IP blocks
5. **Database Sharding**: Partition Supabase tables by date/region
6. **CDN Storage**: Use Supabase Storage with CDN for images

## Legal Notice

This crawler is intended for lawful purposes only. Ensure compliance with:
- Website Terms of Service
- Data Protection Laws (NDPR, GDPR)
- Copyright Laws
- Platform-specific policies
