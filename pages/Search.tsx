
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { User, Biometrics } from '../types';
import { searchCriminalDatabase, analyzeSuspectImage } from '../services/faceEngine';
import { supabaseDb } from '../services/supabaseDb';
import { Search as SearchIcon, Upload, Aperture, Loader2, AlertTriangle, FileUp, Cpu, Database, Shield, Fingerprint, Network, Eye } from 'lucide-react';

interface SearchPageProps {
  user: User;
  onResults: (results: any[], probeImage: string, analysis: string, telemetry: Biometrics | null, auditLogId: string) => void;
  setRightPanel: (panel: React.ReactNode) => void;
}

export const SearchPage: React.FC<SearchPageProps> = ({ user, onResults, setRightPanel }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [deepSearch, setDeepSearch] = useState(false);
  const [loadingText, setLoadingText] = useState('Initializing...');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Clear right panel on mount
  React.useEffect(() => {
    setRightPanel(null);
  }, []);

  const handleFile = async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setLoadingText('Uploading to Secure Node...');
    
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64Img = e.target?.result as string;
      try {
        setLoadingText(deepSearch ? 'Crawling Clearview Index & Face++ API...' : 'Querying Criminal Database...');
        const { results, telemetry } = await searchCriminalDatabase(file, deepSearch);
        
        // Save FORENSIC EVIDENCE (Base64) to log for playback
        const auditLogId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        await supabaseDb.logSearch({
            logId: auditLogId,
            officerId: user.id,
            searchImagePath: base64Img, // Actual image data
            timestamp: new Date().toISOString(),
            resultCount: results.length,
            searchType: deepSearch ? 'DEEP_WEB' : 'LOCAL'
        });

        setLoadingText('Activating Neural Intelligence (Gemini)...');
        const analysis = await analyzeSuspectImage(base64Img);

        onResults(results, base64Img, analysis, telemetry, auditLogId);
      } catch (err: any) {
        setError(err.message || "Search Failed. Check API Configuration.");
      } finally {
        setIsProcessing(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFile(e.dataTransfer.files[0]);
    }
  }, [deepSearch]);

  return (
    <div className="lunar-view lunar-face-search">
      <header className="lunar-page-heading">
        <div><h1>Face search</h1><p>EagleEye investigation / Source image review</p></div>
      </header>
      <section className="lunar-panel lunar-source-panel" aria-labelledby="new-investigation">
        <h2 id="new-investigation">New Investigation</h2>
        <div className="lunar-source-content">
            {error ? (
                 <div className="flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-red-900/50 bg-red-900/10 rounded-lg">
                    <AlertTriangle className="w-12 h-12 text-red-500 mb-4" />
                    <h3 className="text-lg font-bold text-red-400">Could not complete search</h3>
                    <p className="text-slate-400 text-sm mt-2 mb-6">{error}</p>
                    <button 
                        onClick={() => setError(null)}
                        className="lunar-button"
                    >
                        Try another image
                    </button>
                </div>
            ) : isProcessing ? (
                <AdvancedLoadingAnimation loadingText={loadingText} />
            ) : (
                <div 
                    onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={onDrop}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            fileInputRef.current?.click();
                        }
                    }}
                    role="button"
                    tabIndex={0}
                    data-dragging={isDragOver}
                    aria-label="Choose source image"
                    className={`investigation-dropzone h-72 border border-dashed rounded flex flex-col items-center justify-center cursor-pointer transition-all duration-300 group ${isDragOver ? 'border-blue-500 bg-blue-900/10' : 'border-eagle-700 hover:border-blue-500/50 hover:bg-eagle-800'}`}
                >
                    <div className="p-4 bg-eagle-950 rounded mb-4 border border-eagle-700 group-hover:scale-110 transition-transform">
                        <FileUp className="w-8 h-8 text-slate-400 group-hover:text-blue-400" />
                    </div>
                    <h3 className="text-sm font-bold text-slate-300">Drop Source Image</h3>
                    <p className="text-xs text-slate-500 mt-1">or click to browse local drive</p>
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        onChange={(e) => e.target.files && handleFile(e.target.files[0])} 
                        className="hidden" 
                        accept="image/*"
                    />
                </div>
            )}

            {/* Parameters Footer */}
            {!isProcessing && !error && (
                <div className="lunar-source-footer">
                    <label className="flex items-center space-x-3 cursor-pointer group">
                        <div className={`w-8 h-4 rounded-full p-0.5 transition-colors ${deepSearch ? 'bg-purple-600' : 'bg-slate-700'}`}>
                            <div className={`w-3 h-3 bg-white rounded-full transition-transform ${deepSearch ? 'translate-x-4' : ''}`} />
                        </div>
                        <span className="text-xs font-medium text-slate-400 group-hover:text-white transition-colors">Include Web Deep Search</span>
                    </label>
                    <div className="text-xs text-slate-500 font-mono flex items-center">
                        <Aperture size={12} className="mr-1" /> ENGINE: FACE++ V3
                    </div>
                </div>
            )}
        </div>
      </section>
    </div>
  );
};


// Advanced Matrix-style Loading Animation
const AdvancedLoadingAnimation: React.FC<{ loadingText: string }> = ({ loadingText }) => {
    const [logs, setLogs] = useState<string[]>([]);
    const [progress, setProgress] = useState(0);
    
    const systemLogs = [
        'Initializing secure connection...',
        'Authenticating with Face++ Neural Network...',
        'Compressing biometric data...',
        'Uploading encrypted payload...',
        'Scanning 847,293 facial vectors...',
        'Cross-referencing criminal database...',
        'Analyzing geometric facial landmarks...',
        'Computing similarity matrices...',
        'Applying deep learning models...',
        'Extracting feature embeddings...',
        'Running confidence threshold analysis...',
        'Decrypting match results...',
        'Generating intelligence report...'
    ];

    useEffect(() => {
        let logIndex = 0;
        const logInterval = setInterval(() => {
            if (logIndex < systemLogs.length) {
                setLogs(prev => [...prev.slice(-5), systemLogs[logIndex]]);
                logIndex++;
            }
        }, 400);

        const progressInterval = setInterval(() => {
            setProgress(prev => Math.min(prev + Math.random() * 8, 95));
        }, 200);

        return () => {
            clearInterval(logInterval);
            clearInterval(progressInterval);
        };
    }, []);

    return (
        <div className="py-6">
            {/* Main Scanner Animation */}
            <div className="relative h-48 bg-eagle-950 rounded-lg border border-eagle-800 overflow-hidden mb-6">
                {/* Scanning Line */}
                <div className="absolute inset-0 overflow-hidden">
                    <div 
                        className="absolute w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent"
                        style={{
                            animation: 'scan 2s ease-in-out infinite',
                            top: `${(progress % 100)}%`
                        }}
                    />
                </div>
                <style>{`
                    @keyframes scan {
                        0%, 100% { top: 0%; opacity: 1; }
                        50% { top: 100%; opacity: 0.5; }
                    }
                `}</style>
                
                {/* Grid Pattern */}
                <div className="absolute inset-0 opacity-20" style={{
                    backgroundImage: 'linear-gradient(rgba(59,130,246,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.3) 1px, transparent 1px)',
                    backgroundSize: '20px 20px'
                }} />

                {/* Center Icon */}
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="relative">
                        <div className="absolute inset-0 animate-ping">
                            <Fingerprint className="w-20 h-20 text-blue-500/30" />
                        </div>
                        <Fingerprint className="w-20 h-20 text-blue-500 animate-pulse" />
                    </div>
                </div>

                {/* Corner Brackets */}
                <div className="absolute top-2 left-2 w-8 h-8 border-l-2 border-t-2 border-blue-500/50" />
                <div className="absolute top-2 right-2 w-8 h-8 border-r-2 border-t-2 border-blue-500/50" />
                <div className="absolute bottom-2 left-2 w-8 h-8 border-l-2 border-b-2 border-blue-500/50" />
                <div className="absolute bottom-2 right-2 w-8 h-8 border-r-2 border-b-2 border-blue-500/50" />

                {/* Status Indicators */}
                <div className="absolute top-3 left-12 flex items-center space-x-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    <span className="text-[10px] font-mono text-green-500">LIVE</span>
                </div>
                <div className="absolute top-3 right-12 text-[10px] font-mono text-blue-400">
                    {Math.round(progress)}% COMPLETE
                </div>

                {/* Bottom Stats */}
                <div className="absolute bottom-3 left-0 right-0 flex justify-center space-x-6">
                    <div className="flex items-center space-x-1 text-[10px] font-mono text-slate-500">
                        <Cpu size={10} className="text-blue-400" />
                        <span>GPU: 98%</span>
                    </div>
                    <div className="flex items-center space-x-1 text-[10px] font-mono text-slate-500">
                        <Database size={10} className="text-purple-400" />
                        <span>847K VECTORS</span>
                    </div>
                    <div className="flex items-center space-x-1 text-[10px] font-mono text-slate-500">
                        <Network size={10} className="text-green-400" />
                        <span>LATENCY: 42ms</span>
                    </div>
                </div>
            </div>

            {/* Status Text */}
            <div className="text-center mb-4">
                <h3 className="text-lg font-mono font-bold text-white tracking-widest uppercase flex items-center justify-center">
                    <Eye className="w-5 h-5 mr-2 text-blue-500 animate-pulse" />
                    {loadingText}
                </h3>
            </div>

            {/* Progress Bar */}
            <div className="w-full h-2 bg-eagle-800 rounded-full overflow-hidden mb-4">
                <div 
                    className="h-full bg-gradient-to-r from-blue-600 via-purple-500 to-blue-600 transition-all duration-300"
                    style={{ width: `${progress}%` }}
                />
            </div>

            {/* System Logs */}
            <div className="bg-eagle-950 rounded border border-eagle-800 p-3 h-32 overflow-hidden">
                <div className="flex items-center space-x-2 mb-2 pb-2 border-b border-eagle-800">
                    <Shield size={12} className="text-green-500" />
                    <span className="text-[10px] font-mono text-slate-400 uppercase">System Log</span>
                </div>
                <div className="space-y-1 font-mono text-[11px]">
                    {logs.map((log, i) => (
                        <div key={i} className={`flex items-start space-x-2 ${i === logs.length - 1 ? 'text-green-400' : 'text-slate-500'}`}>
                            <span className="text-slate-600">[{new Date().toLocaleTimeString()}]</span>
                            <span>{log}</span>
                        </div>
                    ))}
                    <div className="text-blue-400 animate-pulse">{'>'} _</div>
                </div>
            </div>
        </div>
    );
};
