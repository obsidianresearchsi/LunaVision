import React, { useMemo, useState, useEffect, useRef } from 'react';
import { SearchResult, Biometrics, Suspect } from '../types';
import { 
    Activity, Fingerprint, MapPin, RefreshCw, 
    User, FileText, AlertTriangle, ShieldCheck, Minimize2,
    Network, Map as MapIcon, Siren, Printer, Target, X, Eye, Calendar, Hash, BadgeAlert,
    Shield, Scale, FileWarning, CheckCircle2, Download, FolderPlus, Briefcase
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { SearchReportDocument } from '../components/SearchReportDocument';
import { useDialogAccessibility } from '../components/useDialogAccessibility';
import { imageObservations } from '../utils/imageObservations';
import { AddToCaseModal } from '../components/AddToCaseModal';
import { LinkSearchToCaseModal } from '../components/LinkSearchToCaseModal';
import { CandidateReviewModal } from '../components/CandidateReviewModal';
import { formatSimilarity, similarityTier, SIMILARITY_NOTICE } from '../utils/similarityPresentation';

import L from 'leaflet';
import { basemap } from '../services/mapConfig';

interface ResultsPageProps {
  results: SearchResult[];
  probeImage: string;
  analysis: string;
  telemetry: Biometrics | null;
  officerId: string;
  auditLogId: string;
  onReset: () => void;
  setRightPanel: (panel: React.ReactNode) => void;
}

export const ResultsPage: React.FC<ResultsPageProps> = ({ results, probeImage, analysis, telemetry, onReset, setRightPanel, officerId, auditLogId }) => {
  const [viewMode, setViewMode] = useState<'GRAPH' | 'MAP'>('GRAPH');
  const [selectedSuspect, setSelectedSuspect] = useState<Suspect | null>(null);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [showAddToCaseModal, setShowAddToCaseModal] = useState(false);
  const [selectedResultForCase, setSelectedResultForCase] = useState<SearchResult | null>(null);
  const [showLinkSearchModal, setShowLinkSearchModal] = useState(false);
  const [reviewCandidate, setReviewCandidate] = useState<SearchResult | null>(null);
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;
  
  const currentOfficerId = officerId;
  const currentAuditLogId = auditLogId;
  
  const exactMatches = results.filter(r => r.matchType === 'EXACT');
  const relativeMatches = results.filter(r => r.matchType === 'RELATIVE');

  const stats = useMemo(() => ({
    total: results.length,
    exact: exactMatches.length,
    relative: relativeMatches.length,
    locations: [...new Set(results.map(r => r.suspect.location))].length
  }), [results, exactMatches.length, relativeMatches.length]);

  const handlePrint = () => setShowPrintPreview(true);
  const handleDownload = () => setShowDownloadModal(true);

  // Auto-open print preview when user presses Ctrl+P
  useEffect(() => {
    const handleBeforePrint = () => {
      if (!showPrintPreview) {
        setShowPrintPreview(true);
      }
    };
    window.addEventListener('beforeprint', handleBeforePrint);
    return () => window.removeEventListener('beforeprint', handleBeforePrint);
  }, [showPrintPreview]);

  React.useEffect(() => {
    setRightPanel(
        <div className="h-full flex flex-col no-print">
            <div className="p-3 border-b border-eagle-800 flex justify-between items-center bg-eagle-800/50">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Review context</span>
                <Minimize2 size={14} className="text-slate-500 cursor-pointer" />
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-6">
                <div>
                    <h4 className="text-xxs font-bold text-slate-500 uppercase mb-3 flex items-center">
                        <User size={10} className="mr-1" /> Object Types
                    </h4>
                    <div className="space-y-2">
                        <BarItem label="Candidates" value={stats.total} total={stats.total} color="bg-blue-500" />
                        <BarItem label="Location" value={stats.locations} total={stats.total} color="bg-emerald-500" />
                        <BarItem label="Source image" value={1} total={1} color="bg-purple-500" />
                    </div>
                </div>

                <div className="border-t border-eagle-800 pt-4">
                     <h4 className="text-xxs font-bold text-slate-500 uppercase mb-3 flex items-center">
                        <FileText size={10} className="mr-1" /> Image observations
                    </h4>
                    <ForensicNotesSidebar analysis={analysis} />
                </div>
                <div className="border-t border-eagle-800 pt-4 space-y-2">
                     <button onClick={() => setShowLinkSearchModal(true)} className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 border border-emerald-500 text-white text-xs font-bold rounded flex items-center justify-center">
                        <Briefcase size={12} className="mr-2" /> Link Search to Case
                     </button>
                     <button onClick={handlePrint} className="w-full py-2 bg-eagle-800 hover:bg-eagle-700 border border-eagle-700 text-white text-xs font-bold rounded flex items-center justify-center">
                        <Printer size={12} className="mr-2" /> Print Case File
                     </button>
                     <button onClick={handleDownload} className="w-full py-2 bg-blue-600 hover:bg-blue-500 border border-blue-500 text-white text-xs font-bold rounded flex items-center justify-center">
                        <Download size={12} className="mr-2" /> Download Report
                     </button>
                     <button onClick={() => onResetRef.current()} className="w-full py-2 bg-transparent hover:bg-eagle-800 border border-eagle-700 text-slate-400 text-xs font-bold rounded flex items-center justify-center">
                        <RefreshCw size={12} className="mr-2" /> New Investigation
                     </button>
                </div>
            </div>
        </div>
    );
    return () => setRightPanel(null);
  }, [analysis, telemetry, stats, setRightPanel]);

  return (
    <div className="absolute inset-0 flex flex-col printable-report lunar-results-workspace">
        <div className="print-header hidden">
            <h1 className="text-2xl font-bold">CONFIDENTIAL INTELLIGENCE REPORT</h1>
            <div className="text-sm">Lunar Vision | Generated: {new Date().toLocaleDateString()}</div>
        </div>
        <header className="lunar-page-heading no-print"><div><h1>Investigation results</h1><p>EagleEye investigation / Candidate review</p></div><button type="button" className="lunar-button" onClick={onReset}>New search</button></header>
        <section className="similarity-review-banner no-print"><div><strong>Unverified provider candidates / analyst review required</strong><p>{SIMILARITY_NOTICE}</p><span>Search session: {auditLogId}</span></div><button disabled={!results.length} onClick={() => setReviewCandidate(results[0])}>Open analyst review</button></section>
        {reviewCandidate && <CandidateReviewModal results={results} initialToken={reviewCandidate.suspect.faceToken} auditLogId={auditLogId} officerId={officerId} onClose={() => setReviewCandidate(null)}/>}
        {selectedSuspect && <SuspectDetailCard suspect={selectedSuspect} onClose={() => setSelectedSuspect(null)} />}
        {showPrintPreview && (
            <PrintCaseFileModal auditLogId={auditLogId} officerId={officerId} results={results} probeImage={probeImage} analysis={analysis} telemetry={telemetry} onClose={() => setShowPrintPreview(false)} />
        )}
        {showDownloadModal && (
            <DownloadModal results={results} probeImage={probeImage} analysis={analysis} telemetry={telemetry} onClose={() => setShowDownloadModal(false)} onOpenPrintPreview={() => setShowPrintPreview(true)} />
        )}
        {showAddToCaseModal && selectedResultForCase && (
            <AddToCaseModal
                subject={selectedResultForCase}
                currentOfficerId={currentOfficerId}
                auditLogId={currentAuditLogId}
                onClose={() => {
                    setShowAddToCaseModal(false);
                    setSelectedResultForCase(null);
                }}
                onSuccess={(caseId) => {
                    console.log('Subject linked to case:', caseId);
                }}
            />
        )}
        {showLinkSearchModal && (
            <LinkSearchToCaseModal
                auditLogId={currentAuditLogId}
                searchResults={results}
                probeImagePreview={probeImage}
                currentOfficerId={currentOfficerId}
                onClose={() => setShowLinkSearchModal(false)}
                onSuccess={(caseId) => {
                    console.log('Search linked to case:', caseId);
                }}
            />
        )}
        <div className="lunar-results-canvas flex-1 relative overflow-hidden bg-eagle-950">
            <div className="lunar-results-toolbar absolute top-4 left-4 z-20 flex space-x-2 no-print">
                 <div className="flex space-x-1 bg-eagle-900 border border-eagle-800 rounded-lg p-1 shadow-xl">
                     <button onClick={() => setViewMode('GRAPH')} className={`px-3 py-1.5 rounded flex items-center space-x-2 text-xs font-bold transition-colors ${viewMode === 'GRAPH' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white hover:bg-eagle-800'}`}>
                        <Network size={14} /><span>Candidate graph</span>
                     </button>
                     <button onClick={() => setViewMode('MAP')} className={`px-3 py-1.5 rounded flex items-center space-x-2 text-xs font-bold transition-colors ${viewMode === 'MAP' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white hover:bg-eagle-800'}`}>
                        <MapIcon size={14} /><span>Geo Map</span>
                     </button>
                 </div>
                 <button onClick={handlePrint} className="lunar-button lunar-primary">
                    <Printer size={14} /><span>Print Case File</span>
                 </button>
            </div>
            {viewMode === 'GRAPH' ? <GraphView onReview={setReviewCandidate} results={results} probeImage={probeImage} onViewSuspect={setSelectedSuspect} onAddToCase={(result) => { setSelectedResultForCase(result); setShowAddToCaseModal(true); }} /> : <MapView results={results} />}
        </div>
        {/* Hidden Printable Report - Shows only when printing */}
        <div className="hidden print:block print-only-report">
            <PrintableReport auditLogId={auditLogId} officerId={officerId} results={results} probeImage={probeImage} analysis={analysis} telemetry={telemetry} />
        </div>

    </div>
  );
};


// --- Sub Components ---

const SuspectDetailCard: React.FC<{ suspect: Suspect, onClose: () => void }> = ({ suspect, onClose }) => {
    const statusColors: Record<string, string> = {
        'WANTED': 'bg-red-600 text-white',
        'IN_CUSTODY': 'bg-yellow-600 text-black',
        'CLEARED': 'bg-green-600 text-white',
        'DECEASED': 'bg-slate-600 text-white'
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm no-print" onClick={onClose}>
            <div className="bg-eagle-800 border border-eagle-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="relative h-48 bg-eagle-950">
                    <img src={suspect.imageUrl} alt={suspect.name} className="w-full h-full object-cover opacity-80" />
                    <div className="absolute inset-0 bg-gradient-to-t from-eagle-800 to-transparent" />
                    <button onClick={onClose} className="absolute top-3 right-3 p-2 bg-eagle-900/80 hover:bg-eagle-800 rounded-full text-white transition-colors">
                        <X size={18} />
                    </button>
                    {suspect.status && (
                        <span className={`absolute top-3 left-3 px-3 py-1 rounded-full text-xs font-bold ${statusColors[suspect.status] || 'bg-slate-600'}`}>
                            {suspect.status.replace('_', ' ')}
                        </span>
                    )}
                    <div className="absolute bottom-4 left-4 right-4">
                        <h2 className="text-2xl font-bold text-white">{suspect.name}</h2>
                        <p className="text-sm text-slate-300 mt-1">{suspect.crime}</p>
                    </div>
                </div>
                <div className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-eagle-900 rounded-lg p-3">
                            <div className="flex items-center text-slate-400 text-xs mb-1"><Hash size={12} className="mr-1" /> Face Token</div>
                            <p className="text-white font-mono text-sm truncate">{suspect.faceToken}</p>
                        </div>
                        <div className="bg-eagle-900 rounded-lg p-3">
                            <div className="flex items-center text-slate-400 text-xs mb-1"><Fingerprint size={12} className="mr-1" /> NIN</div>
                            <p className="text-white font-mono text-sm">{suspect.nin || 'N/A'}</p>
                        </div>
                        <div className="bg-eagle-900 rounded-lg p-3">
                            <div className="flex items-center text-slate-400 text-xs mb-1"><MapPin size={12} className="mr-1" /> Location</div>
                            <p className="text-white text-sm">{suspect.location}</p>
                        </div>
                        <div className="bg-eagle-900 rounded-lg p-3">
                            <div className="flex items-center text-slate-400 text-xs mb-1"><User size={12} className="mr-1" /> Gender</div>
                            <p className="text-white text-sm">{suspect.gender || 'Unknown'}</p>
                        </div>
                        {suspect.dob && (
                            <div className="bg-eagle-900 rounded-lg p-3">
                                <div className="flex items-center text-slate-400 text-xs mb-1"><Calendar size={12} className="mr-1" /> Date of Birth</div>
                                <p className="text-white text-sm">{suspect.dob}</p>
                            </div>
                        )}
                        {suspect.coordinates && (
                            <div className="bg-eagle-900 rounded-lg p-3">
                                <div className="flex items-center text-slate-400 text-xs mb-1"><Target size={12} className="mr-1" /> Coordinates</div>
                                <p className="text-white font-mono text-sm">{suspect.coordinates.lat.toFixed(4)}, {suspect.coordinates.lng.toFixed(4)}</p>
                            </div>
                        )}
                    </div>
                    {suspect.physicalMarks && (
                        <div className="bg-eagle-900 rounded-lg p-3">
                            <div className="flex items-center text-slate-400 text-xs mb-1"><BadgeAlert size={12} className="mr-1" /> Physical Marks</div>
                            <p className="text-white text-sm">{suspect.physicalMarks}</p>
                        </div>
                    )}
                    {suspect.notes && (
                        <div className="bg-eagle-900 rounded-lg p-3">
                            <div className="flex items-center text-slate-400 text-xs mb-1"><FileText size={12} className="mr-1" /> Officer Notes</div>
                            <p className="text-white text-sm">{suspect.notes}</p>
                        </div>
                    )}
                    <div className="text-xs text-slate-500 pt-2 border-t border-eagle-700">Source: {suspect.sourceUrl}</div>
                </div>
            </div>
        </div>
    );
};

const GraphView: React.FC<{ results: SearchResult[], probeImage: string, onViewSuspect: (suspect: Suspect) => void, onAddToCase: (result: SearchResult) => void, onReview: (result: SearchResult) => void }> = ({ results, probeImage, onViewSuspect, onAddToCase, onReview }) => {
    return (
        <div className="lunar-result-graph absolute inset-0 flex items-center justify-center p-10">
            <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
                <defs>
                    <marker id="head" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#334155" />
                    </marker>
                </defs>
                {results.map((_, i) => {
                    const yOffset = (i - (results.length - 1) / 2) * 120;
                    return (
                        <line key={i} x1="50%" y1="50%" x2="70%" y2={`calc(50% + ${yOffset}px)`} stroke={_.matchType === 'EXACT' ? '#22b8cb' : '#eab308'} strokeWidth="1" strokeOpacity="0.5" />
                    );
                })}
            </svg>
            <div className="relative z-10 flex items-center justify-center w-full h-full">
                <div className="absolute left-[30%] top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center group cursor-grab active:cursor-grabbing">
                    <div className="w-24 h-24 rounded-full border-4 border-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.5)] overflow-hidden relative bg-black print:border-black">
                        <img src={probeImage.startsWith('data:') ? probeImage : `data:image/jpeg;base64,${probeImage}`} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                        <div className="absolute inset-0 ring-1 ring-white/20 rounded-full"></div>
                    </div>
                    <div className="mt-3 bg-eagle-900/80 backdrop-blur px-3 py-1 rounded border border-blue-500/50 text-center no-print">
                        <div className="text-xs font-bold text-blue-400">SOURCE IMAGE</div>
                        <div className="text-[10px] text-slate-500 font-mono">IMG_SOURCE_001</div>
                    </div>
                </div>
                <div className="absolute right-[20%] top-1/2 -translate-y-1/2 w-64 flex flex-col items-center justify-center space-y-6">
                    {results.length === 0 && <div className="text-slate-500 text-sm italic">No provider candidates returned</div>}
                    {results.map((res, idx) => (
                        <div key={idx} className="relative group flex items-center transform transition-all hover:scale-105 hover:z-50">
                            <div className="w-2 h-2 rounded-full bg-slate-600 mr-2 no-print"></div>
                            <div className={`w-72 bg-eagle-900 border rounded-lg p-2 shadow-xl ${res.matchType === 'EXACT' ? 'border-blue-500/50 shadow-blue-900/20' : 'border-yellow-500/50 shadow-yellow-900/20'} print:border-black print:shadow-none`}>
                                <div className="flex items-start space-x-3">
                                    <div className="w-12 h-12 rounded bg-black shrink-0 overflow-hidden border border-slate-700">
                                        <img src={res.suspect.imageUrl} className="w-full h-full object-cover" />
                                    </div>
                                    <div className="overflow-hidden flex-1">
                                        <div className="flex justify-between items-center w-full">
                                            <h4 className="text-xs font-bold text-white truncate print:text-black">{res.suspect.name}</h4>
                                            <span className={`text-[10px] font-mono px-1 rounded ${res.matchType === 'EXACT' ? 'bg-blue-900 text-blue-300' : 'bg-yellow-900 text-yellow-400'} print:border print:border-black`}>
                                                {formatSimilarity(res.confidence)}
                                            </span>
                                        </div>
                                        <p className="text-[10px] text-slate-400 truncate mt-0.5 print:text-black">{res.suspect.crime}</p>
                                        <div className="flex items-center space-x-2 mt-1">
                                            <span className="text-[10px] text-slate-500 flex items-center print:text-black"><Fingerprint size={8} className="mr-0.5"/> {res.suspect.nin}</span>
                                            <span className="text-[10px] text-slate-500 flex items-center print:text-black"><MapPin size={8} className="mr-0.5"/> {res.suspect.location}</span>
                                        </div>
                                    </div>
                                </div>
                                <p className="candidate-review-label">{similarityTier(res.matchType)} · unverified</p>
                                <div className="mt-2 flex space-x-2 no-print">
                                    <button onClick={() => onViewSuspect(res.suspect)} className="flex-1 py-1.5 bg-blue-600/20 hover:bg-blue-600 border border-blue-500/50 rounded text-xs font-bold text-blue-400 hover:text-white transition-all flex items-center justify-center">
                                        <Eye size={12} className="mr-1" /> View
                                    </button>
                                    <button onClick={() => onAddToCase(res)} className="flex-1 py-1.5 bg-emerald-600/20 hover:bg-emerald-600 border border-emerald-500/50 rounded text-xs font-bold text-emerald-400 hover:text-white transition-all flex items-center justify-center">
                                        <FolderPlus size={12} className="mr-1" /> Add to Case
                                    </button>
                                    <button onClick={() => onReview(res)} className="candidate-review-button">Review</button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
            <div className="absolute bottom-4 left-4 pointer-events-none no-print">
                <div className="bg-eagle-900/80 backdrop-blur border border-eagle-800 p-3 rounded">
                    <h3 className="text-xs font-bold text-slate-300 mb-2">SIMILARITY BANDS</h3>
                    <div className="space-y-1">
                        <div className="flex items-center space-x-2"><div className="w-3 h-0.5 bg-blue-500"></div><span className="text-[10px] text-slate-400">Higher similarity band / unverified</span></div>
                        <div className="flex items-center space-x-2"><div className="w-3 h-0.5 bg-yellow-500"></div><span className="text-[10px] text-slate-400">Lower similarity band / unverified</span></div>
                    </div>
                </div>
            </div>
        </div>
    );
};


const MapView: React.FC<{ results: SearchResult[] }> = ({ results }) => {
    const mapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!mapRef.current) return;

        const ABUJA: L.LatLngTuple = [9.0765, 7.3986];
        const map = L.map(mapRef.current, { zoomControl: false, zoomAnimation: false }).setView(ABUJA, 6);
        L.tileLayer(basemap.url, basemap.options).addTo(map);
        L.control.zoom({ position: 'bottomright' }).addTo(map);

        const crimeSceneIcon = L.divIcon({
            className: 'custom-div-icon',
            html: `<div class="relative flex items-center justify-center"><div class="absolute w-12 h-12 bg-blue-500/20 rounded-full animate-ping"></div><div class="relative w-4 h-4 bg-blue-500 border-2 border-white rounded-full shadow-lg"></div></div>`,
            iconSize: [20, 20], iconAnchor: [10, 10]
        });
        const sceneMarker = L.marker(ABUJA, { icon: crimeSceneIcon }).addTo(map);
        sceneMarker.bindPopup(`<div class="text-xs font-mono p-1 text-slate-900"><strong class="text-blue-600 block mb-1">INVESTIGATION CENTER</strong><span>Abuja, FCT</span></div>`);
        L.circle(ABUJA, { color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.05, radius: 200000, weight: 1, dashArray: '5, 10' }).addTo(map);

        const markers: any[] = [sceneMarker];
        results.forEach(res => {
            if (res.suspect.coordinates) {
                const { lat, lng } = res.suspect.coordinates;
                const isExact = res.matchType === 'EXACT';
                const color = isExact ? '#22b8cb' : '#eab308';
                const borderColor = isExact ? 'border-blue-500' : 'border-yellow-500';
                const iconHtml = res.suspect.imageUrl 
                    ? `<div class="relative group"><div class="w-8 h-8 rounded-full border-2 ${borderColor} overflow-hidden bg-black shadow-[0_0_15px_${color}] relative z-10"><img src="${res.suspect.imageUrl}" class="w-full h-full object-cover" /></div></div>`
                    : `<div style="background-color: ${color}; width: 12px; height: 12px; border-radius: 50%; border: 2px solid #fff;"></div>`;
                const icon = L.divIcon({ className: 'custom-div-icon', html: iconHtml, iconSize: [32, 32], iconAnchor: [16, 36] });
                const marker = L.marker([lat, lng], { icon }).addTo(map);
                L.polyline([ABUJA, [lat, lng]], { color, weight: 1, opacity: 0.3, dashArray: '4, 4' }).addTo(map);
                marker.bindPopup(`<div style="min-width: 180px; font-family: monospace;"><div style="display: flex; gap: 8px; margin-bottom: 8px;"><div style="width: 40px; height: 40px; background: #000; border-radius: 4px; overflow: hidden;"><img src="${res.suspect.imageUrl}" style="width: 100%; height: 100%; object-fit: cover;" /></div><div><strong style="color: #0f172a; display:block; font-size: 12px;">${res.suspect.name}</strong><div style="font-size:10px; color: #64748b;">${res.suspect.crime}</div></div></div><div style="font-size:10px; padding-top: 4px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between;"><span style="color: #64748b;">Provider similarity</span><strong style="color: ${color}">${formatSimilarity(res.confidence)}</strong></div></div>`);
                markers.push(marker);
            }
        });
        if (markers.length > 0) map.fitBounds(L.featureGroup(markers).getBounds().pad(0.1));
        return () => { map.remove(); };
    }, [results]);

    return (
        <div className="w-full h-full bg-eagle-950 relative">
             <div ref={mapRef} className="w-full h-full z-10" />
             <div className="absolute top-4 right-4 z-20 bg-eagle-900/90 backdrop-blur p-3 rounded border border-eagle-800 text-xs text-slate-400 font-mono no-print shadow-xl">
                 <div className="font-bold text-white mb-2 flex items-center"><Target size={14} className="mr-2 text-blue-500" />GEO-INTEL LAYER</div>
                 <div className="space-y-1">
                     <div className="flex justify-between w-40"><span>Candidate records:</span><span className="text-white">{results.filter(r => r.suspect.coordinates).length}</span></div>
                     <div className="flex justify-between w-40"><span>Scope:</span><span className="text-blue-400">Stored locations</span></div>
                 </div>
             </div>
             <div className="absolute bottom-4 right-4 z-20 bg-eagle-900/80 backdrop-blur p-3 rounded border border-eagle-800 text-xs text-slate-400 font-mono no-print">
                 <div className="flex items-center space-x-2 mb-1"><div className="w-3 h-3 rounded-full border-2 border-blue-500 bg-black"></div><span>Higher similarity</span></div>
                 <div className="flex items-center space-x-2"><div className="w-3 h-3 rounded-full border-2 border-yellow-500 bg-black"></div><span>Lower similarity</span></div>
                 <div className="flex items-center space-x-2 mt-1 pt-1 border-t border-eagle-700"><div className="w-3 h-3 rounded-full bg-blue-500 border-2 border-white"></div><span>Investigation Center</span></div>
             </div>
        </div>
    );
};

const BarItem = ({ label, value, total, color }: { label: string, value: number, total: number, color: string }) => (
    <div className="flex items-center space-x-2 text-xxs group cursor-pointer hover:bg-eagle-800 p-1 rounded">
        <div className="w-4 h-4 flex items-center justify-center">
            {label === 'Person' ? <User size={10} className="text-slate-400" /> : <ShieldCheck size={10} className="text-slate-400" />}
        </div>
        <div className="flex-1">
            <div className="flex justify-between mb-0.5"><span className="text-slate-300 font-medium">{label}</span><span className="text-slate-500">{value}</span></div>
            <div className="w-full h-1.5 bg-eagle-950 rounded-full overflow-hidden"><div className={`h-full ${color}`} style={{ width: `${(value / (total || 1)) * 100}%` }}></div></div>
        </div>
    </div>
);


// Generated observations remain separate from verified analyst notes.
const ForensicNotesSidebar: React.FC<{ analysis: string }> = ({ analysis }) => {
    const { notes, unavailable } = imageObservations(analysis);
    return <div className="bg-eagle-950 p-3 rounded border border-eagle-800 space-y-3 text-xs text-slate-400">
        <p className="text-amber-300">AI generated · Unverified image conditions</p>
        {unavailable ? <p>No usable automated observations are available. Review the source image manually.</p> : <ul className="space-y-2">{notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
        <p>Age estimation is not displayed. Verify age using reliable source records.</p>
    </div>;
};

interface PrintCaseFileModalProps {
    results: SearchResult[]; probeImage: string; analysis: string; telemetry: Biometrics | null;
    auditLogId: string; officerId: string; onClose: () => void;
}
const PrintCaseFileModal: React.FC<PrintCaseFileModalProps> = props => {
    const dialog = useRef<HTMLDivElement>(null);
    useDialogAccessibility(dialog, props.onClose);
    const generatedAt = useMemo(() => new Date(), []);
    const reference = useMemo(() => `EE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, []);
    return createPortal(<div ref={dialog} role="dialog" aria-modal="true" aria-label="Case file print preview" tabIndex={-1} className="report-preview fixed inset-0 z-50 flex flex-col">
        <div className="print-modal-controls no-print report-toolbar"><div><small>DOCUMENT WORKSPACE / A4</small><h2>Case File Preview</h2></div><div className="report-toolbar-actions"><button onClick={() => window.print()}><Printer size={16}/> Print / Save PDF</button><button onClick={props.onClose}><X size={16}/> Close</button></div></div>
        <div className="print-document-wrapper report-preview-scroll"><SearchReportDocument {...props} generatedAt={generatedAt} reference={reference}/></div>
    </div>, document.body);
};

const PrintableReport: React.FC<Omit<PrintCaseFileModalProps, 'onClose'>> = props => {
    const generatedAt = useMemo(() => new Date(), []);
    const reference = useMemo(() => `EE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, []);
    return <SearchReportDocument {...props} generatedAt={generatedAt} reference={reference}/>;
};

// Download Modal Component - Simple version that opens Print Preview
interface DownloadModalProps {
    results: SearchResult[];
    probeImage: string;
    analysis: string;
    telemetry: Biometrics | null;
    onClose: () => void;
    onOpenPrintPreview: () => void;
}

const DownloadModal: React.FC<DownloadModalProps> = ({ results, probeImage, analysis, telemetry, onClose, onOpenPrintPreview }) => {
    const caseNumber = useMemo(() => `EE-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`, []);

    const handleDownloadPDF = () => {
        onClose();
        // Small delay to close this modal first, then open print preview
        setTimeout(() => {
            onOpenPrintPreview();
        }, 100);
    };

    const handleDownloadImage = () => {
        // For image download, also use print preview - user can screenshot or use browser's save as image
        onClose();
        setTimeout(() => {
            onOpenPrintPreview();
        }, 100);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-eagle-900 border border-eagle-700 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b border-eagle-800">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <Download className="w-6 h-6 text-blue-500" />
                            <h2 className="text-lg font-bold text-white">Download Report</h2>
                        </div>
                        <button onClick={onClose} className="p-2 hover:bg-eagle-800 rounded-full text-slate-400 hover:text-white transition-colors">
                            <X size={18} />
                        </button>
                    </div>
                    <p className="text-sm text-slate-400 mt-2">Choose your preferred download format</p>
                </div>
                
                <div className="p-6 space-y-4">
                    <button 
                        onClick={handleDownloadPDF}
                        className="w-full p-4 bg-eagle-800 hover:bg-eagle-700 border border-eagle-700 rounded-lg flex items-center space-x-4 transition-colors"
                    >
                        <div className="w-12 h-12 bg-red-600/20 rounded-lg flex items-center justify-center">
                            <FileText className="w-6 h-6 text-red-500" />
                        </div>
                        <div className="text-left flex-1">
                            <div className="font-bold text-white">Save as PDF</div>
                            <div className="text-xs text-slate-400">Opens print preview - select "Save as PDF"</div>
                        </div>
                    </button>
                    
                    <button 
                        onClick={handleDownloadImage}
                        className="w-full p-4 bg-eagle-800 hover:bg-eagle-700 border border-eagle-700 rounded-lg flex items-center space-x-4 transition-colors"
                    >
                        <div className="w-12 h-12 bg-blue-600/20 rounded-lg flex items-center justify-center">
                            <Eye className="w-6 h-6 text-blue-500" />
                        </div>
                        <div className="text-left flex-1">
                            <div className="font-bold text-white">View & Screenshot</div>
                            <div className="text-xs text-slate-400">Opens report for screenshot capture</div>
                        </div>
                    </button>
                </div>
                
                <div className="px-6 py-4 bg-eagle-950 border-t border-eagle-800">
                    <div className="text-xs text-slate-500 text-center">
                        Case: <span className="font-mono text-slate-400">{caseNumber}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};
