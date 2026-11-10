
import React, { useState, useEffect } from 'react';
import { FacePlusPlusService } from '../services/facepp';
import { SettingsService } from '../services/settings';
import { Save, Server, Shield, Database, CheckCircle, AlertCircle, Globe, AlertTriangle, ExternalLink, Loader2, Sparkles, Brain } from 'lucide-react';

export const Settings: React.FC = () => {
    // Face++ Settings
    const [apiKey, setApiKey] = useState('');
    const [apiSecret, setApiSecret] = useState('');
    const [useProxy, setUseProxy] = useState(true);
    const [region, setRegion] = useState<'US' | 'CN'>('US');
    const [status, setStatus] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    
    // Gemini Settings
    const [geminiApiKey, setGeminiApiKey] = useState('');
    const [geminiStatus, setGeminiStatus] = useState<string>('');
    const [isGeminiLoading, setIsGeminiLoading] = useState(false);
    
    const [isLoadingSettings, setIsLoadingSettings] = useState(true);

    useEffect(() => {
        const loadSettings = async () => {
            try {
                const [faceppSettings, geminiSettings] = await Promise.all([
                    SettingsService.getFacePPSettings(),
                    SettingsService.getGeminiSettings()
                ]);
                setApiKey(faceppSettings.apiKey || '');
                setApiSecret(faceppSettings.apiSecret || '');
                setUseProxy(faceppSettings.useProxy ?? true);
                setRegion(faceppSettings.region || 'US');
                setGeminiApiKey(geminiSettings.apiKey || '');
            } catch (e) {
                console.error("Error loading settings from Supabase", e);
            } finally {
                setIsLoadingSettings(false);
            }
        };
        loadSettings();
    }, []);

    const handleSave = async () => {
        // Validation
        if (!apiKey.trim() || !apiSecret.trim()) {
            setStatus('error: API Key and Secret are required.');
            return;
        }
        if (apiKey.trim() === apiSecret.trim()) {
            setStatus('error: API Key and Secret cannot be identical. Please check your Face++ dashboard.');
            return;
        }

        setIsLoading(true);
        setStatus('');
        
        // Clean inputs
        const cleanKey = apiKey.trim();
        const cleanSecret = apiSecret.trim();

        try {
            // Save to Supabase
            await SettingsService.saveFacePPSettings({ 
                apiKey: cleanKey, 
                apiSecret: cleanSecret, 
                useProxy,
                region 
            });

            await FacePlusPlusService.ensureFaceset();
            setStatus('success');
        } catch (e: any) {
            console.error(e);
            setStatus('error: ' + e.message);
        } finally {
            setIsLoading(false);
        }
    };

    if (isLoadingSettings) {
        return (
            <div className="max-w-3xl mx-auto flex items-center justify-center py-20">
                <Loader2 className="animate-spin text-blue-500 mr-3" size={24} />
                <span className="text-slate-400">Loading settings...</span>
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto">
            <header className="lunar-page-heading lunar-investigation-heading mb-8"><div>
                <h1>Configuration</h1><p>EagleEye investigation / Provider connections</p>
            </div></header>

            <div className="bg-eagle-800 border border-eagle-700 rounded-lg overflow-hidden">
                <div className="p-6 border-b border-eagle-700 bg-eagle-900/50 flex justify-between items-center">
                    <h3 className="font-bold text-white flex items-center">
                        <Shield size={18} className="mr-2 text-blue-400" /> 
                        API Credentials (Face++)
                    </h3>
                    <a href="https://console.faceplusplus.com/app/apikey/list" target="_blank" rel="noreferrer" className="text-xs text-blue-400 flex items-center hover:text-blue-300">
                        Get Keys <ExternalLink size={10} className="ml-1" />
                    </a>
                </div>
                
                <div className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-xs font-mono text-blue-300 mb-1 uppercase tracking-wider">API Key</label>
                            <input 
                                type="text" 
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                className="w-full bg-eagle-900 border border-eagle-700 rounded px-4 py-3 text-white focus:outline-none focus:border-blue-500 font-mono text-sm"
                                placeholder="Face++ API Key"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-mono text-blue-300 mb-1 uppercase tracking-wider">API Secret</label>
                            <input 
                                type="password" 
                                value={apiSecret}
                                onChange={(e) => setApiSecret(e.target.value)}
                                className="w-full bg-eagle-900 border border-eagle-700 rounded px-4 py-3 text-white focus:outline-none focus:border-blue-500 font-mono text-sm"
                                placeholder="Face++ API Secret"
                            />
                        </div>
                    </div>

                    {/* Region Selector */}
                    <div>
                        <label className="block text-xs font-mono text-blue-300 mb-2 uppercase tracking-wider">Server Region</label>
                        <div className="grid grid-cols-2 gap-4">
                            <button 
                                onClick={() => setRegion('US')}
                                className={`px-4 py-3 rounded border text-sm font-bold transition-all flex items-center justify-center ${region === 'US' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-eagle-900 border-eagle-700 text-slate-400 hover:border-slate-500'}`}
                            >
                                <span className="mr-2">🇺🇸</span> US Server (api-us)
                            </button>
                            <button 
                                onClick={() => setRegion('CN')}
                                className={`px-4 py-3 rounded border text-sm font-bold transition-all flex items-center justify-center ${region === 'CN' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-eagle-900 border-eagle-700 text-slate-400 hover:border-slate-500'}`}
                            >
                                <span className="mr-2">🇨🇳</span> China Server (api-cn)
                            </button>
                        </div>
                        <p className="text-xs text-slate-500 mt-2">
                            Critical: Your API Key is bound to a specific region. If you get an Auth Error, try switching regions.
                        </p>
                    </div>

                    {/* CORS Proxy Settings */}
                    <div className="bg-eagle-900/30 rounded border border-eagle-700 p-4">
                        <div className="flex items-center justify-between mb-2">
                            <label className="flex items-center space-x-2 text-white font-bold cursor-pointer">
                                <Globe size={18} className="text-blue-400" />
                                <span>Enable CORS Proxy Service</span>
                            </label>
                            <div 
                                onClick={() => setUseProxy(!useProxy)}
                                className={`w-12 h-6 rounded-full p-1 cursor-pointer transition-colors ${useProxy ? 'bg-blue-600' : 'bg-slate-600'}`}
                            >
                                <div className={`w-4 h-4 bg-white rounded-full transition-transform ${useProxy ? 'translate-x-6' : ''}`} />
                            </div>
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed mb-2">
                            {useProxy 
                                ? "Routes traffic through a public proxy (corsproxy.io) to bypass browser security restrictions. Good for demos. May be unstable."
                                : "Direct connection. FASTER but requires a 'Allow CORS' browser extension installed."
                            }
                        </p>
                        {!useProxy && (
                             <div className="flex items-start space-x-2 text-yellow-500 text-xs bg-yellow-900/10 p-2 rounded">
                                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                                <span>Ensure you have an extension like "Allow CORS: Access-Control-Allow-Origin" active, or requests will fail.</span>
                             </div>
                        )}
                    </div>

                    {status === 'success' && (
                        <div className="p-4 bg-green-900/20 border border-green-900/50 rounded flex items-center text-green-400">
                            <CheckCircle size={20} className="mr-2" />
                            <span>Connection Established. Database 'eagleeye_db' verified.</span>
                        </div>
                    )}
                     {status.startsWith('error') && (
                        <div className="p-4 bg-red-900/20 border border-red-900/50 rounded flex items-start text-red-400">
                            <AlertCircle size={20} className="mr-2 mt-0.5 flex-shrink-0" />
                            <span>{status}</span>
                        </div>
                    )}

                    <div className="flex justify-end">
                        <button 
                            onClick={handleSave}
                            disabled={isLoading}
                            className={`flex items-center space-x-2 px-6 py-3 rounded font-bold transition-all ${isLoading ? 'bg-slate-700 text-slate-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}
                        >
                            {isLoading ? (
                                <span>Verifying...</span>
                            ) : (
                                <>
                                    <Save size={18} />
                                    <span>Save & Initialize Link</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
                
                <div className="bg-eagle-900/50 p-4 border-t border-eagle-700 flex items-start space-x-3 text-xs text-slate-500">
                    <Database size={14} className="mt-0.5 flex-shrink-0" />
                    <p>
                        This will attempt to verify credentials with FacePlusPlus ({region} Server). 
                        It will automatically create the faceset <code>eagleeye_db</code> if it does not exist.
                    </p>
                </div>
            </div>

            {/* Gemini AI Settings */}
            <div className="bg-eagle-800 border border-eagle-700 rounded-lg overflow-hidden mt-6">
                <div className="p-6 border-b border-eagle-700 bg-eagle-900/50 flex justify-between items-center">
                    <h3 className="font-bold text-white flex items-center">
                        <Sparkles size={18} className="mr-2 text-purple-400" /> 
                        AI Analysis Engine (Google Gemini)
                    </h3>
                    <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-xs text-purple-400 flex items-center hover:text-purple-300">
                        Get API Key <ExternalLink size={10} className="ml-1" />
                    </a>
                </div>
                
                <div className="p-6 space-y-6">
                    <div className="flex items-start space-x-3 p-3 bg-purple-900/20 border border-purple-700/50 rounded text-sm text-purple-200">
                        <Brain size={18} className="mt-0.5 flex-shrink-0 text-purple-400" />
                        <p>Gemini AI provides forensic facial analysis including age estimation, distinctive features, and expression analysis for investigation reports.</p>
                    </div>

                    <div>
                        <label className="block text-xs font-mono text-purple-300 mb-1 uppercase tracking-wider">Gemini API Key</label>
                        <input 
                            type="password" 
                            value={geminiApiKey}
                            onChange={(e) => setGeminiApiKey(e.target.value)}
                            className="w-full bg-eagle-900 border border-eagle-700 rounded px-4 py-3 text-white focus:outline-none focus:border-purple-500 font-mono text-sm"
                            placeholder="AIza..."
                        />
                        <p className="text-xs text-slate-500 mt-2">
                            Get your free API key from Google AI Studio. Used for forensic analysis in case reports.
                        </p>
                    </div>

                    {geminiStatus === 'success' && (
                        <div className="p-4 bg-green-900/20 border border-green-900/50 rounded flex items-center text-green-400">
                            <CheckCircle size={20} className="mr-2" />
                            <span>Gemini API key saved successfully.</span>
                        </div>
                    )}
                    {geminiStatus.startsWith('error') && (
                        <div className="p-4 bg-red-900/20 border border-red-900/50 rounded flex items-start text-red-400">
                            <AlertCircle size={20} className="mr-2 mt-0.5 flex-shrink-0" />
                            <span>{geminiStatus}</span>
                        </div>
                    )}

                    <div className="flex justify-end">
                        <button 
                            onClick={async () => {
                                const key = geminiApiKey.trim();
                                if (!key) {
                                    setGeminiStatus('error: API Key is required.');
                                    return;
                                }
                                // Validate key format - Google AI Studio keys start with AIza
                                if (!key.startsWith('AIza')) {
                                    setGeminiStatus('error: Invalid API key format. Google AI Studio keys start with "AIza". Get your key from aistudio.google.com/app/apikey');
                                    return;
                                }
                                setIsGeminiLoading(true);
                                setGeminiStatus('');
                                try {
                                    // Test the API key using @google/genai SDK
                                    const { GoogleGenAI } = await import('@google/genai');
                                    const ai = new GoogleGenAI({ apiKey: key });
                                    
                                    // Simple test call
                                    await ai.models.generateContent({
                                        model: 'gemini-2.5-flash',
                                        contents: 'Say OK'
                                    });
                                    
                                    await SettingsService.saveGeminiSettings({ apiKey: key });
                                    setGeminiStatus('success');
                                } catch (e: any) {
                                    console.error('Gemini validation error:', e);
                                    const msg = e.message || 'API key validation failed';
                                    if (msg.includes('API key')) {
                                        setGeminiStatus('error: Invalid API key. Please check your key from aistudio.google.com');
                                    } else if (msg.includes('not found') || msg.includes('not supported')) {
                                        setGeminiStatus('error: Model not available. The API key may be valid but model access is restricted.');
                                    } else {
                                        setGeminiStatus('error: ' + msg);
                                    }
                                } finally {
                                    setIsGeminiLoading(false);
                                }
                            }}
                            disabled={isGeminiLoading}
                            className={`flex items-center space-x-2 px-6 py-3 rounded font-bold transition-all ${isGeminiLoading ? 'bg-slate-700 text-slate-400 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-500 text-white'}`}
                        >
                            {isGeminiLoading ? (
                                <span>Verifying...</span>
                            ) : (
                                <>
                                    <Save size={18} />
                                    <span>Save & Verify Key</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
