
import { Suspect, SearchResult, Biometrics } from '../types';
import { supabaseDb } from './supabaseDb';
import { FacePlusPlusService } from './facepp';
import { SettingsService } from './settings';
import { GoogleGenAI } from "@google/genai";

// Gemini model - using 2.5-flash for fast image analysis
const GEMINI_MODEL = "gemini-2.5-flash";

// Provider result processing. Legacy tier codes are retained for database
// compatibility; they do not establish identity or biological relationships.

// Updated to return both matches and biometric telemetry
export const searchCriminalDatabase = async (imageFile: File, deepSearch: boolean): Promise<{ results: SearchResult[], telemetry: Biometrics }> => {
    // Check credentials first (from Supabase)
    const settings = await SettingsService.getFacePPSettings();
    if (!settings.apiKey?.trim() || !settings.apiSecret?.trim()) {
        throw new Error("System Offline. API Credentials Missing. Please configure in Settings.");
    }

    try {
        // 1. Detect & Analyze (Get real attributes)
        const { token, attributes } = await FacePlusPlusService.detectFaceAndAnalyze(imageFile);
        
        // 2. Search against DB using the detected face_token
        // Face++ compares this token against all faces in the faceset
        const response = await FacePlusPlusService.searchFace(token);
        
        console.log('[Search] Full Face++ response:', JSON.stringify(response, null, 2));
        
        // Check if response is valid
        if (!response) {
            throw new Error("Face++ API returned empty response");
        }
        
        // 3. Process Logic
        const results: SearchResult[] = [];
        // Preserve existing provider thresholds and fallback behavior.
        // Crossing a threshold does not confirm identity or kinship.
        let thresholds = response.thresholds || { "1e-3": 62.3, "1e-5": 73.9 }; 
        let candidates = response.results || [];

        console.log('[Search] Face++ returned', candidates.length, 'candidates');
        console.log('[Search] Thresholds:', thresholds);
        console.log('[Search] Raw candidates:', JSON.stringify(candidates, null, 2));

        const localSuspects = await supabaseDb.getSuspects();
        console.log('[Search] Local suspects count:', localSuspects.length);
        console.log('[Search] Local suspects sample:', localSuspects.slice(0, 3).map(s => ({
            name: s.name,
            faceToken: s.faceToken?.slice(0, 15) + '...'
        })));

        // If no suspects in database at all, throw helpful error
        if (localSuspects.length === 0) {
            throw new Error("No suspects enrolled in database. Please add suspects via Enrollment page first.");
        }

        // Fallback: If Face++ /search returns 0 candidates (e.g. Face++ FaceSet index is degraded or missing thresholds),
        // compare the probe face token directly against enrolled suspects via /compare.
        if (candidates.length === 0) {
            console.log('[Search] FaceSet /search returned 0 candidates. Running direct /compare fallback against enrolled suspects...');
            const manualSuspects = localSuspects.filter(s => s.sourceUrl === 'Manual Enrollment');
            const otherSuspects = localSuspects.filter(s => s.sourceUrl !== 'Manual Enrollment');

            // When deepSearch is off, check manually enrolled suspects first; if deepSearch is on (or no manual matches found), also check crawled suspects.
            const batches = deepSearch ? [manualSuspects, otherSuspects] : [manualSuspects, otherSuspects];
            const fallbackCandidates: Array<{ face_token: string; confidence: number }> = [];

            for (let b = 0; b < batches.length; b++) {
                const batch = batches[b];
                for (const suspect of batch) {
                    // Skip mock/placeholder seed tokens like 'ft_001' that have no real Face++ token
                    const isHexToken = /^[a-f0-9]{32}$/i.test(suspect.faceToken || '');
                    if (!isHexToken) continue;

                    try {
                        let compareRes: { confidence: number; thresholds?: Record<string, number> } | null = null;
                        try {
                            compareRes = await FacePlusPlusService.compareFaces(token, { faceToken: suspect.faceToken });
                        } catch (tokenErr: any) {
                            // If the stored face_token expired on Face++, re-compare using the stored image URL/base64
                            if (tokenErr.message?.includes('INVALID_FACE_TOKEN') && suspect.imageUrl) {
                                if (suspect.imageUrl.startsWith('data:')) {
                                    const base64 = suspect.imageUrl.split(',')[1];
                                    compareRes = await FacePlusPlusService.compareFaces(token, { imageBase64: base64 });
                                } else if (suspect.imageUrl.startsWith('http')) {
                                    compareRes = await FacePlusPlusService.compareFaces(token, { imageUrl: suspect.imageUrl });
                                }
                            } else {
                                throw tokenErr;
                            }
                        }

                        if (compareRes && typeof compareRes.confidence === 'number') {
                            if (compareRes.thresholds) {
                                thresholds = compareRes.thresholds as any;
                            }
                            console.log(`[Search Fallback] Compared with ${suspect.name} (${suspect.faceToken?.slice(0, 10)}...): ${compareRes.confidence.toFixed(2)}%`);
                            fallbackCandidates.push({
                                face_token: suspect.faceToken,
                                confidence: compareRes.confidence
                            });
                        }
                    } catch (cmpErr: any) {
                        console.warn(`[Search Fallback] Skipping ${suspect.name} (${suspect.faceToken}): ${cmpErr.message}`);
                    }
                }

                // If not doing a deep web search and we already found matches among manually enrolled suspects, return immediately for speed!
                const hasMatchAboveThreshold = fallbackCandidates.some(c => c.confidence >= (thresholds['1e-3'] || 62.3));
                if (!deepSearch && b === 0 && hasMatchAboveThreshold) {
                    console.log('[Search Fallback] Found match in enrolled suspects; skipping crawled web records (enable Deep Search to scan all crawled records).');
                    break;
                }
            }

            candidates = fallbackCandidates
                .sort((a, b) => b.confidence - a.confidence)
                .slice(0, 5);
        }

        for (const candidate of candidates) {
            const confidence = candidate.confidence;
            const faceToken = candidate.face_token;
            
            console.log(`[Search] Processing candidate: ${faceToken?.slice(0, 12)}... confidence: ${confidence?.toFixed(2)}`);
            
            // Find suspect details locally by exact face token match
            let suspect = localSuspects.find(s => s.faceToken === faceToken);
            
            // If not found locally (maybe added via crawler directly to Face++ but not synced)
            if (!suspect) {
                console.warn(`[Search] Face token ${faceToken?.slice(0, 12)}... not found in local DB (maybe from crawler)`);
                suspect = {
                    faceToken: faceToken,
                    name: "Unknown Subject",
                    crime: "Unidentified - Database Match",
                    nin: "UNKNOWN",
                    location: "Unknown",
                    imageUrl: "https://via.placeholder.com/150",
                    sourceUrl: "Face++ Index"
                };
            } else {
                console.log(`[Search] ✓ Found local suspect: ${suspect.name}`);
            }

            let matchType: 'EXACT' | 'RELATIVE' | 'NONE' = 'NONE';

            // Legacy tier codes only. Presentation uses neutral similarity labels.
            if (confidence >= thresholds['1e-5']) {
                matchType = 'EXACT';
                console.log('[Search] Higher similarity band');
            } else if (confidence >= thresholds['1e-3']) {
                matchType = 'RELATIVE';
                console.log('[Search] Lower similarity band');
            } else {
                console.log(`[Search] Below threshold: ${confidence.toFixed(2)} < ${thresholds['1e-3']}`);
            }

            // Include all matches above the lowest threshold
            if (matchType !== 'NONE') {
                results.push({
                    suspect,
                    confidence,
                    matchType
                });
            }
        }

        // Map Face++ attributes to our Biometrics type
        const telemetry: Biometrics = {
            gender: attributes.gender,
            age: attributes.age,
            emotion: attributes.emotion
        };

        console.log('[Search] Final results count:', results.length);
        
        if (results.length === 0) {
            console.log('[Search] No matches found above threshold');
            console.log('[Search] - Candidate count from Face++:', candidates.length);
            console.log('[Search] - Lowest threshold:', thresholds['1e-3']);
            
            if (candidates.length === 0) {
                throw new Error("No faces in database match this image. The faceset may be empty or the person is not enrolled.");
            }
        }

        return {
            results: results.sort((a, b) => b.confidence - a.confidence),
            telemetry
        };

    } catch (error: any) {
        console.error("Face++ Search Failed:", error);
        if (error.message.includes("No face detected")) {
            throw new Error("Target acquisition failed: No distinguishable face found in image.");
        }
        throw error;
    }
};

// Gemini API Integration - Using @google/genai SDK
export const analyzeSuspectImage = async (base64Image: string): Promise<string> => {
    try {
        // Get Gemini API key from Supabase settings
        const geminiSettings = await SettingsService.getGeminiSettings();
        
        if (!geminiSettings.apiKey?.trim()) {
            return "Forensic analysis unavailable. Configure Gemini API key in Settings.";
        }

        const apiKey = geminiSettings.apiKey.trim();
        
        // Ensure base64 is clean (remove data:image/... prefix if present)
        const imageData = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;

        // Initialize GoogleGenAI with API key
        const ai = new GoogleGenAI({ apiKey });

        const prompt = `Describe only image conditions relevant to manual review:
1. Lighting and glare
2. Visible blur, cropping, and occlusion
3. Whether the original image context is available or limited

Use a short list of tentative image observations. State limitations explicitly.
Do not identify anyone or infer ethnicity, race, ancestry, nationality, gender,
age, emotion, psychological traits, criminality, family relationships, or threat.
Do not treat appearance or a similarity score as evidence of identity.`;

        const response = await ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: {
                parts: [
                    { 
                        inlineData: { 
                            mimeType: 'image/jpeg', 
                            data: imageData 
                        } 
                    },
                    { text: prompt }
                ]
            }
        });

        return response.text || "Image observations unavailable. Review the source image manually.";
    } catch (e: any) {
        console.error("Intelligence Analysis Failed", e);
        
        // Handle specific error types
        if (e.message?.includes('API key')) {
            return "Invalid Gemini API key. Please check Settings.";
        }
        if (e.message?.includes('not found') || e.message?.includes('not supported')) {
            return "Gemini model unavailable. Please try again later.";
        }
        if (e.message?.includes('quota') || e.message?.includes('rate')) {
            return "API rate limit reached. Please try again in a moment.";
        }
        
        return "Image observations unavailable. Review the source image manually.";
    }
};
