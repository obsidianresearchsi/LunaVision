
import { FacePlusPlusService } from './facepp';
import { supabaseDb } from './supabaseDb';
import { uploadMugshot, StorageError } from './supabaseStorage';
import { compressImage } from '../utils/imageCompression';

// Module B: Crawler Logic

export class CrawlerService {
    private isRunning = false;
    private onLogUpdate: (log: string) => void;

    constructor(onLogUpdate: (log: string) => void) {
        this.onLogUpdate = onLogUpdate;
    }

    log(msg: string) {
        this.onLogUpdate(`[${new Date().toLocaleTimeString()}] ${msg}`);
    }

    // Helper to generate random coordinates roughly within Nigeria (focusing on population centers)
    private getRandomCoordinates() {
        // Nigeria Bounds approx: Lat 4-14, Lng 2-14
        // Focusing on SW/Central for demo density: Lat 6-10, Lng 3-8
        const lat = 6.5 + (Math.random() * 3.5);
        const lng = 3.3 + (Math.random() * 4.7);
        return { lat, lng };
    }

    async start(urls: string[]) {
        this.isRunning = true;
        this.log("Starting Crawler Sequence...");

        try {
            await FacePlusPlusService.ensureFaceset();
            this.log("Connected to 'eagleeye_db'.");
        } catch (e) {
            this.log(`Error connecting to DB: ${e}`);
            this.isRunning = false;
            return;
        }

        for (const url of urls) {
            if (!this.isRunning) break;
            this.log(`Scanning target: ${url}`);

            // SIMULATION OF CHEERIO IMAGE EXTRACTION
            // We use public placeholder images to simulate found mugshots
            
            const simulatedFoundImages = [
                'https://picsum.photos/id/1062/200/300', // Dog? No.
                'https://picsum.photos/id/64/200/300', // Portrait
                'https://picsum.photos/id/91/200/300'  // Portrait
            ];
            
            await new Promise(r => setTimeout(r, 1000)); 

            for (const imgUrl of simulatedFoundImages) {
                if (!this.isRunning) break;
                try {
                    this.log(`Found image candidate: ...${imgUrl.slice(-10)}`);
                    
                    // 1. Detect
                    this.log(`Sending to Face++ Detect API...`);
                    const faceToken = await FacePlusPlusService.detectFace(imgUrl);
                    
                    // 2. Add to DB
                    this.log(`Token ${faceToken.slice(0,8)}... generated. Indexing...`);
                    await FacePlusPlusService.addFaceToFaceset(faceToken);
                    
                    // 3. Fetch, compress, and upload image to Supabase Storage
                    this.log(`Fetching and compressing image...`);
                    let storageUrl: string;
                    try {
                        // Fetch the image from URL
                        const response = await fetch(imgUrl);
                        if (!response.ok) {
                            throw new Error(`Failed to fetch image: ${response.statusText}`);
                        }
                        const imageBlob = await response.blob();
                        
                        // Compress the image
                        const compressedBlob = await compressImage(imageBlob, 450, 0.9);
                        
                        // Upload to Supabase Storage
                        this.log(`Uploading to Supabase Storage...`);
                        storageUrl = await uploadMugshot(faceToken, compressedBlob);
                    } catch (uploadError: any) {
                        if (uploadError instanceof StorageError) {
                            throw new Error(`Storage upload failed: ${uploadError.message}`);
                        }
                        throw uploadError;
                    }
                    
                    // 4. Save to Supabase with storage URL
                    const coords = this.getRandomCoordinates();
                    await supabaseDb.addSuspect({
                        faceToken: faceToken,
                        name: "Unknown (Crawled)",
                        crime: "Pending Investigation",
                        nin: "N/A",
                        location: "Web Source",
                        imageUrl: storageUrl,
                        sourceUrl: url,
                        coordinates: coords // Add Coords for Map View
                    });
                    
                    this.log(`Subject Indexed Successfully at [${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}].`);
                } catch (e: any) {
                    this.log(`Indexing failed: ${e.message}`);
                }
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        this.isRunning = false;
        this.log("Crawl Sequence Complete.");
    }

    stop() {
        this.isRunning = false;
        this.log("Aborting sequence...");
    }
}
