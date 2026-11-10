import React, { useState, useEffect, useRef } from 'react';
import { crawlerApi, CrawlStats, DatabaseStats } from '../services/crawlerApi';
import { Square, Play, Activity, Globe, Server, Wifi, WifiOff, Database, Users, Clock, AlertTriangle, Instagram, Facebook, Twitter } from 'lucide-react';

export const Crawler: React.FC = () => {
    const [isRunning, setIsRunning] = useState(false);
    const [isBackendOnline, setIsBackendOnline] = useState(false);
    const [stats, setStats] = useState<CrawlStats>({
        pagesScanned: 0,
        imagesFound: 0,
        facesDetected: 0,
        facesIndexed: 0,
        errors: 0,
    });
    const [dbStats, setDbStats] = useState<DatabaseStats>({ total: 0, today: 0, sources: 0 });
    const [logs, setLogs] = useState<string[]>(['Initializing crawler system...']);
    const [urls, setUrls] = useState('https://punchng.com\nhttps://www.vanguardngr.com\nhttps://guardian.ng');
    const [activeTab, setActiveTab] = useState<'web' | 'social'>('web');
    const [socialPlatform, setSocialPlatform] = useState<'instagram' | 'facebook' | 'twitter'>('instagram');
    const [socialTerms, setSocialTerms] = useState('lagos\nnigeria\nafrica');

    // Check backend health on mount
    useEffect(() => {
        const checkBackend = async () => {
            const online = await crawlerApi.checkHealth();
            setIsBackendOnline(online);
            if (online) {
                addLog('Backend server connected');
                const status = await crawlerApi.getStatus();
                if (status && status.status === 'running') {
                    setIsRunning(true);
                    setStats(status.stats);
                }
                const dbStatsData = await crawlerApi.getStats();
                setDbStats(dbStatsData);
            } else {
                addLog('WARNING: Backend server offline. Start it with: cd crawler-backend && npm run dev');
            }
        };
        checkBackend();
        const interval = setInterval(checkBackend, 10000);
        return () => clearInterval(interval);
    }, []);


    // Connect to SSE stream when running
    useEffect(() => {
        if (isRunning && isBackendOnline) {
            crawlerApi.connectStream({
                onStats: (newStats) => {
                    setStats(newStats);
                    if (newStats.currentUrl) {
                        addLog(`Scanning: ${newStats.currentUrl}`);
                    }
                },
                onFaceIndexed: (face) => {
                    addLog(`✓ Face indexed: ${face.faceToken.slice(0, 8)}... from ${face.sourceDomain}`);
                    setDbStats(prev => ({ ...prev, total: prev.total + 1, today: prev.today + 1 }));
                },
                onCompleted: (job) => {
                    addLog(`Crawl completed. Total faces indexed: ${job.stats.facesIndexed}`);
                    setIsRunning(false);
                },
                onStopped: () => {
                    addLog('Crawl stopped by user');
                    setIsRunning(false);
                },
            });
        }
        return () => crawlerApi.disconnectStream();
    }, [isRunning, isBackendOnline]);

    const addLog = (msg: string) => {
        setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 99)]);
    };

    const startWebCrawl = async () => {
        if (!isBackendOnline) {
            addLog('ERROR: Backend server is offline');
            return;
        }
        const urlList = urls.split('\n').filter(u => u.trim());
        if (urlList.length === 0) {
            addLog('ERROR: No URLs provided');
            return;
        }
        addLog(`Starting web crawl with ${urlList.length} seed URLs...`);
        const result = await crawlerApi.startCrawl(urlList);
        if (result.success) {
            setIsRunning(true);
            addLog(`Crawl job started: ${result.jobId}`);
        } else {
            addLog(`ERROR: ${result.error}`);
        }
    };

    const startSocialCrawl = async () => {
        if (!isBackendOnline) {
            addLog('ERROR: Backend server is offline');
            return;
        }
        const terms = socialTerms.split('\n').filter(t => t.trim());
        if (terms.length === 0) {
            addLog('ERROR: No search terms provided');
            return;
        }
        addLog(`Starting ${socialPlatform} crawl with terms: ${terms.join(', ')}`);
        const result = await crawlerApi.startSocialCrawl(socialPlatform, terms);
        if (result.success) {
            setIsRunning(true);
        } else {
            addLog(`ERROR: ${result.error}`);
        }
    };

    const stopCrawl = async () => {
        addLog('Stopping crawl...');
        await crawlerApi.stopCrawl();
        setIsRunning(false);
    };

    return (
        <div className="h-full flex flex-col space-y-4">
            {/* Header */}
            <div className="lunar-page-heading lunar-investigation-heading">
                <div>
                    <h1>
                        <Globe className="mr-3 text-blue-500" /> Web crawler
                    </h1>
                    <p className="text-slate-400 text-sm">Automated Web Scraping & Face Indexing Engine</p>
                </div>
                <div className="flex items-center space-x-4">
                    {/* Backend Status */}
                    <div className={`flex items-center space-x-2 px-3 py-2 rounded border ${isBackendOnline ? 'bg-green-900/30 border-green-700' : 'bg-red-900/30 border-red-700'}`}>
                        {isBackendOnline ? <Wifi className="w-4 h-4 text-green-500" /> : <WifiOff className="w-4 h-4 text-red-500" />}
                        <span className={`text-xs font-bold ${isBackendOnline ? 'text-green-400' : 'text-red-400'}`}>
                            {isBackendOnline ? 'BACKEND ONLINE' : 'BACKEND OFFLINE'}
                        </span>
                    </div>
                    {/* Stats */}
                    <div className="flex items-center space-x-4 bg-eagle-800 px-4 py-2 rounded border border-eagle-700">
                        <div className="flex items-center space-x-2">
                            <Database className="w-4 h-4 text-blue-500" />
                            <span className="font-mono text-lg font-bold text-white">{(dbStats?.total || 0).toLocaleString()}</span>
                            <span className="text-xs text-slate-500">Total</span>
                        </div>
                        <div className="w-px h-6 bg-eagle-700" />
                        <div className="flex items-center space-x-2">
                            <Clock className="w-4 h-4 text-green-500" />
                            <span className="font-mono text-lg font-bold text-white">{dbStats?.today || 0}</span>
                            <span className="text-xs text-slate-500">Today</span>
                        </div>
                    </div>
                </div>
            </div>


            {/* Main Content */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
                {/* Configuration Panel */}
                <div className="lg:col-span-1 bg-eagle-800 border border-eagle-700 rounded-lg flex flex-col overflow-hidden">
                    {/* Tabs */}
                    <div className="flex border-b border-eagle-700">
                        <button 
                            onClick={() => setActiveTab('web')}
                            className={`flex-1 py-3 text-sm font-bold flex items-center justify-center space-x-2 ${activeTab === 'web' ? 'bg-eagle-900 text-white border-b-2 border-blue-500' : 'text-slate-400 hover:text-white'}`}
                        >
                            <Globe size={14} /> <span>Web Crawl</span>
                        </button>
                        <button 
                            onClick={() => setActiveTab('social')}
                            className={`flex-1 py-3 text-sm font-bold flex items-center justify-center space-x-2 ${activeTab === 'social' ? 'bg-eagle-900 text-white border-b-2 border-blue-500' : 'text-slate-400 hover:text-white'}`}
                        >
                            <Users size={14} /> <span>Social Media</span>
                        </button>
                    </div>

                    <div className="flex-1 p-4 flex flex-col overflow-hidden">
                        {activeTab === 'web' ? (
                            <>
                                <h3 className="text-sm font-bold text-slate-300 mb-2">Target URLs (one per line)</h3>
                                <textarea 
                                    value={urls}
                                    onChange={(e) => setUrls(e.target.value)}
                                    disabled={isRunning}
                                    className="flex-1 bg-eagle-900 border border-eagle-700 rounded p-3 text-sm font-mono text-blue-300 focus:outline-none focus:border-blue-500 resize-none disabled:opacity-50"
                                    placeholder="https://example.com"
                                />
                            </>
                        ) : (
                            <>
                                <h3 className="text-sm font-bold text-slate-300 mb-2">Platform</h3>
                                <div className="flex space-x-2 mb-4">
                                    {[
                                        { id: 'instagram', icon: Instagram, color: 'text-pink-500' },
                                        { id: 'facebook', icon: Facebook, color: 'text-blue-500' },
                                        { id: 'twitter', icon: Twitter, color: 'text-sky-500' },
                                    ].map(p => (
                                        <button
                                            key={p.id}
                                            onClick={() => setSocialPlatform(p.id as any)}
                                            disabled={isRunning}
                                            className={`flex-1 py-2 rounded border flex items-center justify-center space-x-2 ${socialPlatform === p.id ? 'bg-eagle-900 border-blue-500' : 'border-eagle-700 hover:border-eagle-600'} disabled:opacity-50`}
                                        >
                                            <p.icon size={16} className={p.color} />
                                            <span className="text-xs text-white capitalize">{p.id}</span>
                                        </button>
                                    ))}
                                </div>
                                <h3 className="text-sm font-bold text-slate-300 mb-2">Search Terms (one per line)</h3>
                                <textarea 
                                    value={socialTerms}
                                    onChange={(e) => setSocialTerms(e.target.value)}
                                    disabled={isRunning}
                                    className="flex-1 bg-eagle-900 border border-eagle-700 rounded p-3 text-sm font-mono text-blue-300 focus:outline-none focus:border-blue-500 resize-none disabled:opacity-50"
                                    placeholder="lagos&#10;nigeria"
                                />
                            </>
                        )}
                    </div>

                    {/* Warning */}
                    {!isBackendOnline && (
                        <div className="mx-4 mb-4 p-3 bg-yellow-900/30 border border-yellow-700 rounded text-xs text-yellow-300 flex items-start space-x-2">
                            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                            <div>
                                <strong>Backend Required</strong>
                                <p className="text-yellow-400/80 mt-1">Start the crawler backend:</p>
                                <code className="block mt-1 bg-black/30 px-2 py-1 rounded">cd crawler-backend && npm run dev</code>
                            </div>
                        </div>
                    )}

                    {/* Action Button */}
                    <div className="p-4 border-t border-eagle-700">
                        <button 
                            onClick={isRunning ? stopCrawl : (activeTab === 'web' ? startWebCrawl : startSocialCrawl)}
                            disabled={!isBackendOnline && !isRunning}
                            className={`w-full py-3 rounded font-bold flex items-center justify-center space-x-2 transition-all disabled:opacity-50 ${isRunning ? 'bg-red-900/50 text-red-400 hover:bg-red-900/70' : 'bg-green-600 text-white hover:bg-green-500'}`}
                        >
                            {isRunning ? (
                                <><Square size={16} fill="currentColor" /> <span>HALT SEQUENCE</span></>
                            ) : (
                                <><Play size={16} fill="currentColor" /> <span>INITIATE CRAWL</span></>
                            )}
                        </button>
                    </div>
                </div>


                {/* Terminal & Stats */}
                <div className="lg:col-span-2 flex flex-col space-y-4 min-h-0">
                    {/* Live Stats */}
                    <div className="grid grid-cols-5 gap-3">
                        {[
                            { label: 'Pages Scanned', value: stats.pagesScanned, color: 'text-blue-400' },
                            { label: 'Images Found', value: stats.imagesFound, color: 'text-purple-400' },
                            { label: 'Faces Detected', value: stats.facesDetected, color: 'text-yellow-400' },
                            { label: 'Faces Indexed', value: stats.facesIndexed, color: 'text-green-400' },
                            { label: 'Errors', value: stats.errors, color: 'text-red-400' },
                        ].map(stat => (
                            <div key={stat.label} className="bg-eagle-800 border border-eagle-700 rounded p-3 text-center">
                                <div className={`text-2xl font-mono font-bold ${stat.color}`}>{stat.value}</div>
                                <div className="text-[10px] text-slate-500 uppercase mt-1">{stat.label}</div>
                            </div>
                        ))}
                    </div>

                    {/* Terminal */}
                    <div className="flex-1 bg-black border border-eagle-700 rounded-lg p-4 font-mono text-xs flex flex-col relative overflow-hidden min-h-0">
                        <div className="absolute top-2 right-4 text-eagle-700 font-bold text-4xl opacity-20 pointer-events-none">TTY-1</div>
                        <div className="flex items-center space-x-2 mb-3 pb-2 border-b border-eagle-800">
                            <Activity className={`w-4 h-4 ${isRunning ? 'text-green-500 animate-pulse' : 'text-slate-600'}`} />
                            <span className={`text-xs font-bold ${isRunning ? 'text-green-400' : 'text-slate-500'}`}>
                                {isRunning ? 'CRAWLING...' : 'IDLE'}
                            </span>
                            {stats.currentUrl && (
                                <span className="text-slate-600 truncate ml-2">→ {stats.currentUrl}</span>
                            )}
                        </div>
                        <div className="flex-1 overflow-y-auto space-y-1 z-10 scrollbar-hide">
                            {logs.map((log, i) => (
                                <div key={i} className={`${
                                    log.includes('ERROR') ? 'text-red-500' :
                                    log.includes('WARNING') ? 'text-yellow-500' :
                                    log.includes('✓') ? 'text-green-500' :
                                    i === 0 ? 'text-white' : 'text-green-900'
                                }`}>
                                    <span className="mr-2 opacity-50">{'>'}</span>{log}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
