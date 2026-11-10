
import { FacePPSettings } from '../types';
import { SettingsService } from './settings';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './supabase';
import { compressImage } from '../utils/imageCompression';

// Module A: Face++ Client
// Handles the raw API interactions
export class FacePlusPlusService {
  private static FACEPP_HOST_US = 'https://api-us.faceplusplus.com/facepp/v3';
  private static FACEPP_HOST_CN = 'https://api-cn.faceplusplus.com/facepp/v3';
  
  // Supabase Edge Function URL for CORS-free proxy
  private static SUPABASE_PROXY_URL = `${SUPABASE_URL}/functions/v1/facepp-proxy`;
  
  // Fallback public CORS proxies (used only if Supabase proxy fails)
  private static PROXY_LIST = [
      'https://corsproxy.io/?',
      'https://api.allorigins.win/raw?url=',
  ];
  
  private static OUTER_ID = 'eagleeye_db'; // Simplified ID

  // Concurrency & Rate Limiting
  private static requestQueue: Promise<any> = Promise.resolve();
  private static lastRequestTime = 0;
  private static MIN_REQUEST_INTERVAL_MS = 1200; 
  
  // Initialization State
  private static _facesetReady = false;
  private static _initializationPromise: Promise<void> | null = null;

  // Cached credentials for sync access
  private static cachedCredentials: FacePPSettings | null = null;

  private static getCredentials(): FacePPSettings | null {
    // Return cached credentials (must be loaded first via loadCredentials)
    return this.cachedCredentials || {
        apiKey: '',
        apiSecret: '',
        useProxy: true,
        region: 'US'
    };
  }

  // Load credentials from Supabase (call before operations)
  private static async loadCredentials(): Promise<FacePPSettings> {
    this.cachedCredentials = await SettingsService.getFacePPSettings();
    return this.cachedCredentials;
  }

  private static async updateCredentials(updates: Partial<FacePPSettings>) {
      const current = this.cachedCredentials || { apiKey: '', apiSecret: '', useProxy: true, region: 'US' };
      const updated = { ...current, ...updates };
      await SettingsService.saveFacePPSettings(updated);
      this.cachedCredentials = updated;
      console.log("System Settings Updated Automatically:", updates);
  }

  private static getHost(region?: 'US' | 'CN'): string {
      return region === 'CN' ? this.FACEPP_HOST_CN : this.FACEPP_HOST_US;
  }

  private static async toFormData(params: Record<string, any>): Promise<FormData> {
    // Ensure credentials are loaded from Supabase
    const creds = await this.loadCredentials();
    console.log('[Face++] Loaded credentials:', { 
        hasApiKey: !!creds?.apiKey, 
        hasApiSecret: !!creds?.apiSecret,
        apiKeyLength: creds?.apiKey?.length || 0,
        apiSecretLength: creds?.apiSecret?.length || 0
    });
    
    if (!creds || !creds.apiKey?.trim() || !creds.apiSecret?.trim()) {
        throw new Error("API Credentials missing. Please configure API Key & Secret in Settings.");
    }

    const formData = new FormData();
    formData.append('api_key', creds.apiKey.trim());
    formData.append('api_secret', creds.apiSecret.trim());
    
    for (const key in params) {
      if (params[key] !== undefined && params[key] !== null) {
          formData.append(key, String(params[key]));
      }
    }
    return formData;
  }

  // Helper to convert File/Blob to Base64 (removes data: prefix)
  private static fileToBase64(file: Blob): Promise<string> {
      return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = () => {
              const res = reader.result as string;
              // Remove data:image/jpeg;base64, prefix
              // We split by comma and take the second part
              const base64 = res.split(',')[1];
              resolve(base64);
          };
          reader.onerror = error => reject(error);
      });
  }

  // Enforce Rate Limits by chaining promises
  private static async scheduleRequest<T>(fn: () => Promise<T>): Promise<T> {
      this.requestQueue = this.requestQueue.then(async () => {
          const now = Date.now();
          const timeSinceLast = now - this.lastRequestTime;
          if (timeSinceLast < this.MIN_REQUEST_INTERVAL_MS) {
              await new Promise(r => setTimeout(r, this.MIN_REQUEST_INTERVAL_MS - timeSinceLast));
          }
          this.lastRequestTime = Date.now();
      }).catch(() => {});

      return this.requestQueue.then(fn);
  }

  // Helper for fetch with timeout
  private static async fetchWithTimeout(url: string, options: RequestInit, timeout = 10000): Promise<Response> {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      try {
          const response = await fetch(url, { ...options, signal: controller.signal });
          clearTimeout(id);
          return response;
      } catch (e) {
          clearTimeout(id);
          throw e;
      }
  }

  // Convert FormData to plain object for JSON serialization
  private static formDataToObject(formData: FormData): Record<string, string> {
    const obj: Record<string, string> = {};
    formData.forEach((value, key) => {
      obj[key] = String(value);
    });
    return obj;
  }

  // Safe Fetch via Supabase Edge Function (primary) with fallback to public proxies
  private static async safeFetch(endpoint: string, formData: FormData, retryCount = 0, useSupabaseProxy = true): Promise<any> {
    return this.scheduleRequest(async () => {
        const creds = this.getCredentials();
        const region = creds?.region || 'US';

        try {
            // Try Supabase Edge Function first (no CORS issues)
            if (useSupabaseProxy) {
                if (retryCount === 0) console.log(`[Face++] POST ${endpoint} [${region}] via Supabase Proxy`);
                
                const formDataObj = this.formDataToObject(formData);
                
                const res = await this.fetchWithTimeout(this.SUPABASE_PROXY_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                        'apikey': SUPABASE_ANON_KEY,
                    },
                    body: JSON.stringify({
                        endpoint,
                        region,
                        formData: formDataObj
                    })
                }, 15000);

                const data = await res.json();
                
                // Handle API errors
                if (data.error_message) {
                    return this.handleApiError(data.error_message, endpoint, formData, retryCount, region);
                }
                
                if (data.error) {
                    throw new Error(data.error);
                }
                
                return data;
            }
            
            // Fallback: Direct call (requires CORS extension)
            console.log(`[Face++] POST ${endpoint} [${region}] Direct (CORS extension required)`);
            const host = this.getHost(region);
            const targetUrl = `${host}${endpoint}`;
            
            const res = await this.fetchWithTimeout(targetUrl, { method: 'POST', body: formData });
            const data = await res.json();
            
            if (data.error_message) {
                return this.handleApiError(data.error_message, endpoint, formData, retryCount, region);
            }
            
            return data;

        } catch (e: any) {
            console.error(`[Face++] Request failed:`, e.message);
            
            // If Supabase proxy failed, try direct (user needs CORS extension)
            if (useSupabaseProxy && retryCount < 1) {
                console.warn(`Supabase proxy failed. Trying direct connection...`);
                return this.safeFetch(endpoint, formData, retryCount + 1, false);
            }
            
            if (e.message === 'INVALID_OUTER_ID') throw e;
            if (e.message.startsWith('API Error')) throw e;

            throw new Error("Connection Failed: Unable to reach Face++ API. Check your network or try again.");
        }
    });
  }

  // Handle Face++ API errors with retry logic
  private static async handleApiError(errMsg: string, endpoint: string, formData: FormData, retryCount: number, region: string): Promise<any> {
    // 1. Concurrency limit
    if (errMsg === 'CONCURRENCY_LIMIT_EXCEEDED' && retryCount < 3) {
        console.warn(`Rate limit hit. Retrying in 2s... (${retryCount + 1}/3)`);
        await new Promise(r => setTimeout(r, 2000 * (retryCount + 1)));
        return this.safeFetch(endpoint, formData, retryCount + 1, true);
    }

    // 2. Auth Error (Auto-Region switch)
    if (errMsg === 'AUTHENTICATION_ERROR' && retryCount === 0) {
        console.warn(`Auth failed on ${region}. Attempting region switch...`);
        const newRegion = region === 'US' ? 'CN' : 'US';
        this.updateCredentials({ region: newRegion });
        return this.safeFetch(endpoint, formData, retryCount + 1, true);
    }

    if (errMsg === 'INVALID_OUTER_ID') throw new Error('INVALID_OUTER_ID');
    
    throw new Error(`API Error: ${errMsg}`);
  }

  // Logic to process image inputs for FormData
  private static async prepareImageFormData(imageFile: File | Blob | string, params: Record<string, any> = {}): Promise<FormData> {
      const formData = await this.toFormData(params);
      try {
        if (typeof imageFile === 'string') {
            // Check if it's already a data URI
            if (imageFile.startsWith('data:')) {
                // Convert data URI to blob, compress, then to base64
                const response = await fetch(imageFile);
                const blob = await response.blob();
                const compressed = await compressImage(blob, 800, 0.85);
                const base64 = await this.fileToBase64(compressed);
                console.log(`[Face++] Image compressed: ${Math.round(base64.length / 1024)}KB`);
                formData.append('image_base64', base64);
            } else if (imageFile.startsWith('http')) {
                // It's a URL.
                try {
                   const creds = this.getCredentials();
                   const useProxy = creds?.useProxy ?? true;
                   // Use first proxy for simple GET if needed
                   const proxy = this.PROXY_LIST[0]; 
                   const fetchUrl = useProxy ? `${proxy}${encodeURIComponent(imageFile)}` : imageFile;
                   
                   const res = await fetch(fetchUrl);
                   const blob = await res.blob();
                   const compressed = await compressImage(blob, 800, 0.85);
                   const base64 = await this.fileToBase64(compressed);
                   console.log(`[Face++] Image compressed: ${Math.round(base64.length / 1024)}KB`);
                   formData.append('image_base64', base64);
                } catch (e) {
                   console.warn("Failed to fetch image client-side, falling back to direct image_url param", e);
                   formData.append('image_url', imageFile);
                }
            } else {
                formData.append('image_base64', imageFile);
            }
        } else {
            // Compress File/Blob before converting to base64
            const compressed = await compressImage(imageFile, 800, 0.85);
            const base64 = await this.fileToBase64(compressed);
            console.log(`[Face++] Image compressed: ${Math.round(base64.length / 1024)}KB`);
            formData.append('image_base64', base64);
        }
    } catch (e) {
        console.error("Image processing failed:", e);
        throw new Error("Failed to process image for upload.");
    }
    return formData;
  }

  // 1. DETECT API
  static async detectFace(imageFile: File | Blob | string): Promise<string> {
    const formData = await this.prepareImageFormData(imageFile);
    const data = await this.safeFetch('/detect', formData);
    
    if (!data.faces || data.faces.length === 0) {
        throw new Error("No face detected. Please ensure the subject is facing the camera and well-lit.");
    }
    return data.faces[0].face_token;
  }

  // 1b. DETECT & ANALYZE (New)
  // Returns face token AND biometric attributes
  static async detectFaceAndAnalyze(imageFile: File | Blob | string): Promise<{token: string, attributes: any}> {
    const formData = await this.prepareImageFormData(imageFile, {
        return_attributes: 'gender,age,emotion'
    });
    const data = await this.safeFetch('/detect', formData);
    
    if (!data.faces || data.faces.length === 0) {
        throw new Error("No face detected. Please ensure the subject is facing the camera and well-lit.");
    }
    return {
        token: data.faces[0].face_token,
        attributes: data.faces[0].attributes
    };
  }

  // 2. FACESET APIs (Database)
  static async ensureFaceset(): Promise<void> {
    if (this._facesetReady) return;
    if (this._initializationPromise) return this._initializationPromise;

    this._initializationPromise = (async () => {
        try {
            const formData = await this.toFormData({ outer_id: this.OUTER_ID });
            await this.safeFetch('/faceset/getdetail', formData);
            console.log("Faceset Verified.");
            this._facesetReady = true;
        } catch (e: any) {
            const errMsg = e.message;
            if (errMsg.includes('INVALID_OUTER_ID') || errMsg.includes('FACESET_NOT_EXIST')) {
                console.log("Faceset missing. Creating...");
                try {
                    const createParams = await this.toFormData({ 
                        outer_id: this.OUTER_ID, 
                        display_name: "EagleEye_DB" 
                    });
                    await this.safeFetch('/faceset/create', createParams);
                    console.log("Faceset Created.");
                    this._facesetReady = true;
                } catch (createErr: any) {
                    if (createErr.message.includes('CONCURRENCY_LIMIT_EXCEEDED')) {
                         throw createErr;
                    }
                    console.error("Failed to create faceset:", createErr);
                    throw createErr;
                }
            } else {
                throw e;
            }
        } finally {
            this._initializationPromise = null;
        }
    })();

    return this._initializationPromise;
  }

  static async addFaceToFaceset(faceToken: string): Promise<void> {
    await this.ensureFaceset();
    const formData = await this.toFormData({
        outer_id: this.OUTER_ID,
        face_tokens: faceToken
    });
    const res = await this.safeFetch('/faceset/addface', formData);
    if (res?.face_added === 0 && res?.failure_detail?.length > 0) {
        console.warn('[Face++] Faceset addface reported failure_detail (subject will still be searchable via fallback comparison):', res.failure_detail);
    }
  }

  // 2b. COMPARE API - 1:1 comparison between two face tokens (or probe token + image_url/base64)
  static async compareFaces(faceToken1: string, secondFace: { faceToken?: string; imageUrl?: string; imageBase64?: string }): Promise<{ confidence: number; thresholds?: Record<string, number> }> {
    const params: Record<string, any> = { face_token1: faceToken1 };
    if (secondFace.faceToken) {
        params.face_token2 = secondFace.faceToken;
    } else if (secondFace.imageBase64) {
        params.image_base64_2 = secondFace.imageBase64;
    } else if (secondFace.imageUrl) {
        params.image_url2 = secondFace.imageUrl;
    }
    const formData = await this.toFormData(params);
    return this.safeFetch('/compare', formData);
  }

  // 3. SEARCH API - Search using face_token from detect
  static async searchFace(faceToken: string): Promise<any> {
    await this.ensureFaceset();
    const formData = await this.toFormData({
        face_token: faceToken,
        outer_id: this.OUTER_ID,
        return_result_count: 5
    });
    
    console.log('[Face++] Searching with face_token:', faceToken.slice(0, 20) + '...');
    console.log('[Face++] Searching in faceset:', this.OUTER_ID);
    
    const response = await this.safeFetch('/search', formData);
    
    console.log('[Face++] Search response received:', {
        hasResults: !!response.results,
        resultCount: response.results?.length || 0,
        hasThresholds: !!response.thresholds,
        rawResponse: response
    });
    
    return response;
  }
}
