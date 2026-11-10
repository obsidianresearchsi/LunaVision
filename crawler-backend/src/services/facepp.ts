import axios from 'axios';
import FormData from 'form-data';
import { config } from '../config';
import { logger } from '../utils/logger';

class FacePlusPlusService {
    private baseUrl = config.facepp.baseUrl;

    private async makeRequest(endpoint: string, data: FormData): Promise<any> {
        try {
            const response = await axios.post(`${this.baseUrl}${endpoint}`, data, {
                headers: data.getHeaders(),
                timeout: 30000,
            });
            return response.data;
        } catch (error: any) {
            if (error.response) {
                logger.error('Face++ API error', { 
                    status: error.response.status, 
                    data: error.response.data 
                });
                throw new Error(`Face++ API error: ${error.response.data?.error_message || 'Unknown error'}`);
            }
            throw error;
        }
    }

    async detectFace(imageBuffer: Buffer): Promise<{ faceToken: string; attributes: any } | null> {
        const formData = new FormData();
        formData.append('api_key', config.facepp.apiKey);
        formData.append('api_secret', config.facepp.apiSecret);
        formData.append('image_base64', imageBuffer.toString('base64'));
        formData.append('return_attributes', 'gender,age,ethnicity');

        const result = await this.makeRequest('/detect', formData);

        if (!result.faces || result.faces.length === 0) {
            return null;
        }

        // Return the largest face (most prominent)
        const largestFace = result.faces.reduce((prev: any, curr: any) => {
            const prevArea = prev.face_rectangle.width * prev.face_rectangle.height;
            const currArea = curr.face_rectangle.width * curr.face_rectangle.height;
            return currArea > prevArea ? curr : prev;
        });

        return {
            faceToken: largestFace.face_token,
            attributes: largestFace.attributes,
        };
    }

    async detectFaceFromUrl(imageUrl: string): Promise<{ faceToken: string; attributes: any } | null> {
        const formData = new FormData();
        formData.append('api_key', config.facepp.apiKey);
        formData.append('api_secret', config.facepp.apiSecret);
        formData.append('image_url', imageUrl);
        formData.append('return_attributes', 'gender,age,ethnicity');

        const result = await this.makeRequest('/detect', formData);

        if (!result.faces || result.faces.length === 0) {
            return null;
        }

        const largestFace = result.faces.reduce((prev: any, curr: any) => {
            const prevArea = prev.face_rectangle.width * prev.face_rectangle.height;
            const currArea = curr.face_rectangle.width * curr.face_rectangle.height;
            return currArea > prevArea ? curr : prev;
        });

        return {
            faceToken: largestFace.face_token,
            attributes: largestFace.attributes,
        };
    }

    async addToFaceset(faceToken: string, retries = 3): Promise<void> {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const formData = new FormData();
                formData.append('api_key', config.facepp.apiKey);
                formData.append('api_secret', config.facepp.apiSecret);
                formData.append('outer_id', config.facepp.facesetToken);
                formData.append('face_tokens', faceToken);

                const result = await this.makeRequest('/faceset/addface', formData);
                
                // Check if face was actually added
                if (result.face_added === 0 && result.face_count !== undefined) {
                    logger.warn('Face may already exist in faceset', { faceToken: faceToken.slice(0, 8) });
                }
                
                return; // Success
            } catch (error: any) {
                if (error.message.includes('CONCURRENCY_LIMIT_EXCEEDED') && attempt < retries) {
                    logger.warn(`Rate limit hit, retrying in ${attempt * 2}s...`, { attempt });
                    await new Promise(r => setTimeout(r, attempt * 2000));
                    continue;
                }
                throw error;
            }
        }
    }

    async ensureFaceset(): Promise<void> {
        const formData = new FormData();
        formData.append('api_key', config.facepp.apiKey);
        formData.append('api_secret', config.facepp.apiSecret);
        formData.append('outer_id', config.facepp.facesetToken);
        formData.append('display_name', 'EagleEye Criminal Database');

        try {
            await this.makeRequest('/faceset/create', formData);
            logger.info('Created new faceset', { outer_id: config.facepp.facesetToken });
        } catch (error: any) {
            if (error.message.includes('FACESET_EXIST')) {
                logger.debug('Faceset already exists');
            } else {
                throw error;
            }
        }
    }

    async searchFace(imageBuffer: Buffer): Promise<Array<{ faceToken: string; confidence: number }>> {
        const formData = new FormData();
        formData.append('api_key', config.facepp.apiKey);
        formData.append('api_secret', config.facepp.apiSecret);
        formData.append('image_base64', imageBuffer.toString('base64'));
        formData.append('outer_id', config.facepp.facesetToken);
        formData.append('return_result_count', '10');

        const result = await this.makeRequest('/search', formData);

        if (!result.results) {
            return [];
        }

        return result.results.map((r: any) => ({
            faceToken: r.face_token,
            confidence: r.confidence,
        }));
    }
}

export const facePlusPlusService = new FacePlusPlusService();
