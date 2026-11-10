// Frontend service to communicate with the Crawler Backend

// @ts-ignore - Vite env
const CRAWLER_API_URL = (import.meta as any).env?.VITE_CRAWLER_API_URL || 'http://localhost:3001';

export interface CrawlStats {
    pagesScanned: number;
    imagesFound: number;
    facesDetected: number;
    facesIndexed: number;
    errors: number;
    currentUrl?: string;
}

export interface CrawlJob {
    id: string;
    urls: string[];
    status: 'pending' | 'running' | 'completed' | 'stopped' | 'error';
    stats: CrawlStats;
    startedAt?: string;
    completedAt?: string;
}

export interface DatabaseStats {
    total: number;
    today: number;
    sources: number;
}

class CrawlerApiService {
    private eventSource: EventSource | null = null;
    private onStatsUpdate: ((stats: CrawlStats) => void) | null = null;
    private onFaceIndexed: ((face: any) => void) | null = null;
    private onStatusChange: ((status: string) => void) | null = null;

    async startCrawl(urls: string[]): Promise<{ success: boolean; jobId?: string; error?: string }> {
        try {
            const response = await fetch(`${CRAWLER_API_URL}/api/crawler/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urls }),
            });
            return await response.json();
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    async stopCrawl(): Promise<{ success: boolean }> {
        try {
            const response = await fetch(`${CRAWLER_API_URL}/api/crawler/stop`, {
                method: 'POST',
            });
            return await response.json();
        } catch (error) {
            return { success: false };
        }
    }


    async getStatus(): Promise<CrawlJob | null> {
        try {
            const response = await fetch(`${CRAWLER_API_URL}/api/crawler/status`);
            const data = await response.json();
            return data.status === 'idle' ? null : data;
        } catch (error) {
            return null;
        }
    }

    async getStats(): Promise<DatabaseStats> {
        try {
            const response = await fetch(`${CRAWLER_API_URL}/api/crawler/stats`);
            if (!response.ok) {
                return { total: 0, today: 0, sources: 0 };
            }
            const data = await response.json();
            return {
                total: data.total || 0,
                today: data.today || 0,
                sources: data.sources || 0,
            };
        } catch (error) {
            return { total: 0, today: 0, sources: 0 };
        }
    }

    async startSocialCrawl(platform: string, searchTerms: string[]): Promise<{ success: boolean; error?: string }> {
        try {
            const response = await fetch(`${CRAWLER_API_URL}/api/crawler/social`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ platform, searchTerms }),
            });
            return await response.json();
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    // Real-time updates via Server-Sent Events
    connectStream(callbacks: {
        onStats?: (stats: CrawlStats) => void;
        onFaceIndexed?: (face: any) => void;
        onCompleted?: (job: CrawlJob) => void;
        onStopped?: (job: CrawlJob) => void;
    }): void {
        if (this.eventSource) {
            this.eventSource.close();
        }

        this.eventSource = new EventSource(`${CRAWLER_API_URL}/api/crawler/stream`);

        this.eventSource.addEventListener('stats', (e) => {
            const stats = JSON.parse(e.data);
            callbacks.onStats?.(stats);
        });

        this.eventSource.addEventListener('faceIndexed', (e) => {
            const face = JSON.parse(e.data);
            callbacks.onFaceIndexed?.(face);
        });

        this.eventSource.addEventListener('completed', (e) => {
            const job = JSON.parse(e.data);
            callbacks.onCompleted?.(job);
        });

        this.eventSource.addEventListener('stopped', (e) => {
            const job = JSON.parse(e.data);
            callbacks.onStopped?.(job);
        });

        this.eventSource.onerror = () => {
            console.error('SSE connection error');
        };
    }

    disconnectStream(): void {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
    }

    // Check if backend is available
    async checkHealth(): Promise<boolean> {
        try {
            const response = await fetch(`${CRAWLER_API_URL}/health`);
            return response.ok;
        } catch {
            return false;
        }
    }
}

export const crawlerApi = new CrawlerApiService();
