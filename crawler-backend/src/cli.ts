#!/usr/bin/env node
import { config } from './config';
import { logger } from './utils/logger';
import { webCrawler } from './crawler/WebCrawler';
import { socialMediaCrawler } from './crawler/SocialMediaCrawler';
import { v4 as uuidv4 } from 'uuid';

const args = process.argv.slice(2);
const command = args[0];

async function main() {
    switch (command) {
        case 'crawl':
            await runWebCrawl(args.slice(1));
            break;
        case 'social':
            await runSocialCrawl(args.slice(1));
            break;
        case 'news':
            await crawlNigerianNews();
            break;
        case 'help':
        default:
            printHelp();
    }
}

async function runWebCrawl(urls: string[]) {
    if (urls.length === 0) {
        console.log('Usage: npm run crawl -- crawl <url1> <url2> ...');
        process.exit(1);
    }

    logger.info('Starting web crawl', { urls });
    const jobId = uuidv4();

    webCrawler.on('statsUpdate', (stats) => {
        process.stdout.write(`\rPages: ${stats.pagesScanned} | Images: ${stats.imagesFound} | Faces: ${stats.facesIndexed}`);
    });

    webCrawler.on('faceIndexed', (face) => {
        console.log(`\n✓ Indexed: ${face.faceToken.slice(0, 8)}... from ${face.sourceDomain}`);
    });

    const result = await webCrawler.startCrawl(jobId, urls);
    console.log('\n\nCrawl completed:', result.stats);
    process.exit(0);
}


async function runSocialCrawl(args: string[]) {
    const platform = args[0] as any;
    const terms = args.slice(1);

    if (!platform || terms.length === 0) {
        console.log('Usage: npm run crawl -- social <platform> <term1> <term2> ...');
        console.log('Platforms: facebook, instagram, twitter');
        process.exit(1);
    }

    logger.info('Starting social media crawl', { platform, terms });

    socialMediaCrawler.on('faceIndexed', (face) => {
        console.log(`✓ Indexed: ${face.faceToken.slice(0, 8)}... from ${face.sourceDomain}`);
    });

    const count = await socialMediaCrawler.crawlPublicProfiles({
        platform,
        searchTerms: terms,
        maxProfiles: 100,
        maxImagesPerProfile: 30,
    });

    console.log(`\nSocial crawl completed. Faces indexed: ${count}`);
    await socialMediaCrawler.close();
    process.exit(0);
}

async function crawlNigerianNews() {
    // Pre-configured Nigerian news sources
    const nigerianNewsSites = [
        'https://punchng.com',
        'https://www.vanguardngr.com',
        'https://guardian.ng',
        'https://www.premiumtimesng.com',
        'https://dailypost.ng',
        'https://www.thecable.ng',
        'https://saharareporters.com',
        'https://www.channelstv.com',
        'https://www.naijanews.com',
        'https://www.legit.ng',
    ];

    logger.info('Starting Nigerian news crawl', { sites: nigerianNewsSites.length });
    const jobId = uuidv4();

    webCrawler.on('statsUpdate', (stats) => {
        process.stdout.write(`\rPages: ${stats.pagesScanned} | Images: ${stats.imagesFound} | Faces: ${stats.facesIndexed}`);
    });

    const result = await webCrawler.startCrawl(jobId, nigerianNewsSites);
    console.log('\n\nNigerian news crawl completed:', result.stats);
    process.exit(0);
}

function printHelp() {
    console.log(`
EagleEye Crawler CLI

Commands:
  crawl <url1> <url2> ...     Crawl specific URLs
  social <platform> <terms>   Crawl social media (facebook, instagram, twitter)
  news                        Crawl Nigerian news sites (pre-configured)
  help                        Show this help

Examples:
  npm run crawl -- crawl https://example.com
  npm run crawl -- social instagram lagos nigeria
  npm run crawl -- news
    `);
}

main().catch(err => {
    logger.error('CLI error', { error: err.message });
    process.exit(1);
});
