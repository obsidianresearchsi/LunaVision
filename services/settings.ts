import { supabase } from './supabase';
import { FacePPSettings, GeminiSettings } from '../types';

const FACEPP_KEY = 'facepp_credentials';
const GEMINI_KEY = 'gemini_credentials';

// Cache to avoid repeated DB calls
let cachedFacePPSettings: FacePPSettings | null = null;
let cachedGeminiSettings: GeminiSettings | null = null;
let faceppCacheTimestamp = 0;
let geminiCacheTimestamp = 0;
const CACHE_TTL_MS = 30000; // 30 seconds

export const SettingsService = {
    /**
     * Get Face++ credentials from Supabase
     */
    async getFacePPSettings(): Promise<FacePPSettings> {
        if (cachedFacePPSettings && Date.now() - faceppCacheTimestamp < CACHE_TTL_MS) {
            return cachedFacePPSettings;
        }

        const { data, error } = await supabase
            .from('settings')
            .select('value')
            .eq('key', FACEPP_KEY)
            .single();

        if (error || !data?.value) {
            return { apiKey: '', apiSecret: '', useProxy: true, region: 'US' };
        }

        cachedFacePPSettings = data.value as FacePPSettings;
        faceppCacheTimestamp = Date.now();
        return cachedFacePPSettings;
    },

    /**
     * Save Face++ credentials to Supabase
     */
    async saveFacePPSettings(settings: FacePPSettings): Promise<void> {
        const { error } = await supabase
            .from('settings')
            .upsert({ key: FACEPP_KEY, value: settings });

        if (error) throw new Error('Failed to save settings: ' + error.message);

        cachedFacePPSettings = settings;
        faceppCacheTimestamp = Date.now();
    },

    /**
     * Get Gemini API key from Supabase
     */
    async getGeminiSettings(): Promise<GeminiSettings> {
        if (cachedGeminiSettings && Date.now() - geminiCacheTimestamp < CACHE_TTL_MS) {
            return cachedGeminiSettings;
        }

        const { data, error } = await supabase
            .from('settings')
            .select('value')
            .eq('key', GEMINI_KEY)
            .single();

        if (error || !data?.value) {
            return { apiKey: '' };
        }

        cachedGeminiSettings = data.value as GeminiSettings;
        geminiCacheTimestamp = Date.now();
        return cachedGeminiSettings;
    },

    /**
     * Save Gemini API key to Supabase
     */
    async saveGeminiSettings(settings: GeminiSettings): Promise<void> {
        const { error } = await supabase
            .from('settings')
            .upsert({ key: GEMINI_KEY, value: settings });

        if (error) throw new Error('Failed to save Gemini settings: ' + error.message);

        cachedGeminiSettings = settings;
        geminiCacheTimestamp = Date.now();
    },

    /**
     * Clear all settings cache
     */
    clearCache(): void {
        cachedFacePPSettings = null;
        cachedGeminiSettings = null;
        faceppCacheTimestamp = 0;
        geminiCacheTimestamp = 0;
    }
};
