import React, { useState, useEffect, useMemo } from 'react';
import { supabaseDb } from '../services/supabaseDb';
import { Suspect } from '../types';
import { 
    Globe, Search, Filter, Grid, List, Eye, MapPin, 
    ExternalLink, Download, X, User, Hash, Fingerprint, 
    ChevronLeft, ChevronRight, Layers, Image as ImageIcon,
    Calendar, SortAsc, SortDesc, FolderOpen
} from 'lucide-react';

const ITEMS_PER_PAGE = 24;

export const CrawledFaces: React.FC = () => {
    const [faces, setFaces] = useState<Suspect[]>([]);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState<'grid' | 'list' | 'grouped'>('grid');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedFace, setSelectedFace] = useState<Suspect | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [sortBy, setSortBy] = useState<'name' | 'date' | 'source'>('date');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [selectedSource, setSelectedSource] = useState<string | null>(null);
    const [showFilters, setShowFilters] = useState(false);

    const loadCrawledFaces = async () => {
        setLoading(true);
        try {
            const allSuspects = await supabaseDb.getSuspects();
            const crawled = allSuspects.filter(s => 
                s.sourceUrl && s.sourceUrl !== 'police_db' && s.sourceUrl !== 'Manual Enrollment'
            );
            setFaces(crawled);
        } catch (error) {
            console.error('Failed to load crawled faces:', error);
        }
        setLoading(false);
    };

    useEffect(() => { loadCrawledFaces(); }, []);

    const getDomain = (url: string) => {
        try { return new URL(url).hostname.replace('www.', ''); } catch { return url; }
    };

    // Get unique sources for filtering
    const sources = useMemo(() => {
        const sourceMap = new Map<string, number>();
        faces.forEach(f => {
            const domain = getDomain(f.sourceUrl);
            sourceMap.set(domain, (sourceMap.get(domain) || 0) + 1);
        });
        return Array.from(sourceMap.entries()).sort((a, b) => b[1] - a[1]);
    }, [faces]);

    // Filter and sort faces
    const processedFaces = useMemo(() => {
        let result = [...faces];
        
        // Filter by search query
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            result = result.filter(f =>
                f.name.toLowerCase().includes(q) ||
                f.sourceUrl.toLowerCase().includes(q) ||
                f.location.toLowerCase().includes(q)
            );
        }
        
        // Filter by selected source
        if (selectedSource) {
            result = result.filter(f => getDomain(f.sourceUrl) === selectedSource);
        }
        
        // Sort
        result.sort((a, b) => {
            let cmp = 0;
            if (sortBy === 'name') cmp = a.name.localeCompare(b.name);
            else if (sortBy === 'source') cmp = getDomain(a.sourceUrl).localeCompare(getDomain(b.sourceUrl));
            else cmp = (a.faceToken || '').localeCompare(b.faceToken || ''); // date approximation
            return sortOrder === 'asc' ? cmp : -cmp;
        });
        
        return result;
    }, [faces, searchQuery, selectedSource, sortBy, sortOrder]);

    // Group faces by source
    const groupedFaces = useMemo(() => {
        const groups = new Map<string, Suspect[]>();
        processedFaces.forEach(f => {
            const domain = getDomain(f.sourceUrl);
            if (!groups.has(domain)) groups.set(domain, []);
            groups.get(domain)!.push(f);
        });
        return Array.from(groups.entries());
    }, [processedFaces]);

    // Pagination
    const totalPages = Math.ceil(processedFaces.length / ITEMS_PER_PAGE);
    const paginatedFaces = processedFaces.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

    useEffect(() => { setCurrentPage(1); }, [searchQuery, selectedSource]);

    const stats = { total: faces.length, sources: sources.length, filtered: processedFaces.length };

    return (
        <div className="h-full flex flex-col space-y-4">
            {/* Header */}
            <div className="lunar-page-heading lunar-investigation-heading">
                <div>
                    <h1>
                        <Globe className="mr-3 text-purple-500" /> Crawled faces
                    </h1>
                    <p className="text-slate-400 text-sm">Faces collected from web sources via automated crawling</p>
                </div>
                <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-4 bg-eagle-800 px-4 py-2 rounded border border-eagle-700">
                        <div className="text-center">
                            <div className="text-2xl font-mono font-bold text-purple-400">{stats.total}</div>
                            <div className="text-[10px] text-slate-500 uppercase">Total</div>
                        </div>
                        <div className="w-px h-8 bg-eagle-700" />
                        <div className="text-center">
                            <div className="text-2xl font-mono font-bold text-blue-400">{stats.sources}</div>
                            <div className="text-[10px] text-slate-500 uppercase">Sources</div>
                        </div>
                        {selectedSource && (
                            <>
                                <div className="w-px h-8 bg-eagle-700" />
                                <div className="text-center">
                                    <div className="text-2xl font-mono font-bold text-green-400">{stats.filtered}</div>
                                    <div className="text-[10px] text-slate-500 uppercase">Filtered</div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Toolbar */}
            <div className="flex items-center justify-between bg-eagle-800 border border-eagle-700 rounded-lg p-3">
                <div className="flex items-center space-x-3 flex-1">
                    <div className="relative flex-1 max-w-md">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input
                            type="text"
                            placeholder="Search by name, source, location..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-eagle-900 border border-eagle-700 rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                        />
                    </div>
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={`px-3 py-2 rounded flex items-center space-x-2 text-sm ${showFilters ? 'bg-purple-600 text-white' : 'bg-eagle-900 text-slate-400 hover:text-white border border-eagle-700'}`}
                    >
                        <Filter size={16} /><span>Filters</span>
                    </button>
                    {/* Sort */}
                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as any)}
                        className="bg-eagle-900 border border-eagle-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
                    >
                        <option value="date">Sort by Date</option>
                        <option value="name">Sort by Name</option>
                        <option value="source">Sort by Source</option>
                    </select>
                    <button
                        onClick={() => setSortOrder(o => o === 'asc' ? 'desc' : 'asc')}
                        className="p-2 bg-eagle-900 border border-eagle-700 rounded text-slate-400 hover:text-white"
                    >
                        {sortOrder === 'asc' ? <SortAsc size={18} /> : <SortDesc size={18} />}
                    </button>
                </div>
                <div className="flex items-center space-x-2 ml-4">
                    <button onClick={() => setViewMode('grid')} className={`p-2 rounded ${viewMode === 'grid' ? 'bg-purple-600 text-white' : 'bg-eagle-900 text-slate-400 hover:text-white'}`}><Grid size={18} /></button>
                    <button onClick={() => setViewMode('list')} className={`p-2 rounded ${viewMode === 'list' ? 'bg-purple-600 text-white' : 'bg-eagle-900 text-slate-400 hover:text-white'}`}><List size={18} /></button>
                    <button onClick={() => setViewMode('grouped')} className={`p-2 rounded ${viewMode === 'grouped' ? 'bg-purple-600 text-white' : 'bg-eagle-900 text-slate-400 hover:text-white'}`} title="Group by Website"><Layers size={18} /></button>
                </div>
            </div>

            {/* Filters Panel */}
            {showFilters && (
                <div className="bg-eagle-800 border border-eagle-700 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-bold text-white flex items-center"><FolderOpen size={14} className="mr-2" /> Filter by Source</h3>
                        {selectedSource && (
                            <button onClick={() => setSelectedSource(null)} className="text-xs text-purple-400 hover:text-purple-300">Clear Filter</button>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {sources.map(([domain, count]) => (
                            <button
                                key={domain}
                                onClick={() => setSelectedSource(selectedSource === domain ? null : domain)}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center space-x-2 transition-colors ${
                                    selectedSource === domain 
                                        ? 'bg-purple-600 text-white' 
                                        : 'bg-eagle-900 text-slate-400 hover:text-white border border-eagle-700'
                                }`}
                            >
                                <Globe size={12} />
                                <span>{domain}</span>
                                <span className="bg-black/30 px-1.5 py-0.5 rounded-full text-[10px]">{count}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-auto">
                {loading ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : processedFaces.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-500">
                        <Globe size={48} className="mb-4 opacity-50" />
                        <p className="text-lg">No crawled faces found</p>
                        <p className="text-sm mt-2">{searchQuery || selectedSource ? 'Try adjusting your filters' : 'Start the crawler to collect faces'}</p>
                    </div>
                ) : viewMode === 'grouped' ? (
                    <div className="space-y-6">
                        {groupedFaces.map(([domain, domainFaces]) => (
                            <div key={domain} className="bg-eagle-800/50 border border-eagle-700 rounded-lg overflow-hidden">
                                <div className="bg-eagle-900 px-4 py-3 flex items-center justify-between border-b border-eagle-700">
                                    <div className="flex items-center space-x-3">
                                        <Globe size={18} className="text-purple-400" />
                                        <span className="font-bold text-white">{domain}</span>
                                        <span className="px-2 py-0.5 bg-purple-600/30 text-purple-300 text-xs rounded-full">{domainFaces.length} faces</span>
                                    </div>
                                    <a href={`https://${domain}`} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-400 hover:text-white flex items-center">
                                        <ExternalLink size={12} className="mr-1" /> Visit Site
                                    </a>
                                </div>
                                <div className="p-4 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
                                    {domainFaces.slice(0, 16).map(face => (
                                        <div key={face.faceToken} onClick={() => setSelectedFace(face)} className="cursor-pointer group">
                                            <div className="aspect-square bg-eagle-950 rounded-lg overflow-hidden border border-eagle-700 group-hover:border-purple-500 transition-colors">
                                                <img src={face.imageUrl} alt={face.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                                            </div>
                                            <p className="text-[10px] text-slate-400 truncate mt-1 text-center">{face.name}</p>
                                        </div>
                                    ))}
                                    {domainFaces.length > 16 && (
                                        <button 
                                            onClick={() => { setSelectedSource(domain); setViewMode('grid'); }}
                                            className="aspect-square bg-eagle-900 rounded-lg border border-eagle-700 flex flex-col items-center justify-center text-slate-400 hover:text-white hover:border-purple-500 transition-colors"
                                        >
                                            <span className="text-lg font-bold">+{domainFaces.length - 16}</span>
                                            <span className="text-[10px]">more</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : viewMode === 'grid' ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                        {paginatedFaces.map(face => (
                            <FaceCard key={face.faceToken} face={face} onView={() => setSelectedFace(face)} />
                        ))}
                    </div>
                ) : (
                    <div className="space-y-2">
                        {paginatedFaces.map(face => (
                            <FaceListItem key={face.faceToken} face={face} onView={() => setSelectedFace(face)} />
                        ))}
                    </div>
                )}
            </div>

            {/* Pagination */}
            {viewMode !== 'grouped' && totalPages > 1 && (
                <div className="flex items-center justify-between bg-eagle-800 border border-eagle-700 rounded-lg px-4 py-3">
                    <div className="text-sm text-slate-400">
                        Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} - {Math.min(currentPage * ITEMS_PER_PAGE, processedFaces.length)} of {processedFaces.length}
                    </div>
                    <div className="flex items-center space-x-2">
                        <button
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            className="p-2 bg-eagle-900 border border-eagle-700 rounded text-slate-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <ChevronLeft size={18} />
                        </button>
                        <div className="flex items-center space-x-1">
                            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                let page: number;
                                if (totalPages <= 5) page = i + 1;
                                else if (currentPage <= 3) page = i + 1;
                                else if (currentPage >= totalPages - 2) page = totalPages - 4 + i;
                                else page = currentPage - 2 + i;
                                return (
                                    <button
                                        key={page}
                                        onClick={() => setCurrentPage(page)}
                                        className={`w-8 h-8 rounded text-sm font-medium ${currentPage === page ? 'bg-purple-600 text-white' : 'bg-eagle-900 text-slate-400 hover:text-white'}`}
                                    >
                                        {page}
                                    </button>
                                );
                            })}
                        </div>
                        <button
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                            className="p-2 bg-eagle-900 border border-eagle-700 rounded text-slate-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <ChevronRight size={18} />
                        </button>
                    </div>
                </div>
            )}

            {/* Detail Modal */}
            {selectedFace && <FaceDetailModal face={selectedFace} onClose={() => setSelectedFace(null)} />}
        </div>
    );
};


// Face Card Component (Grid View)
const FaceCard: React.FC<{ face: Suspect; onView: () => void }> = ({ face, onView }) => {
    const getDomain = (url: string) => {
        try { return new URL(url).hostname.replace('www.', ''); } catch { return url; }
    };

    return (
        <div onClick={onView} className="bg-eagle-800 border border-eagle-700 rounded-lg overflow-hidden cursor-pointer hover:border-purple-500 transition-all group">
            <div className="aspect-square bg-eagle-950 relative overflow-hidden">
                <img src={face.imageUrl} alt={face.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="absolute bottom-2 left-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className="w-full py-1.5 bg-purple-600 hover:bg-purple-500 rounded text-xs font-bold text-white flex items-center justify-center">
                        <Eye size={12} className="mr-1" /> View Details
                    </button>
                </div>
                <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/70 rounded text-[10px] text-purple-300 font-mono truncate max-w-[90%]">
                    {getDomain(face.sourceUrl)}
                </div>
            </div>
            <div className="p-3">
                <h3 className="text-sm font-bold text-white truncate">{face.name}</h3>
                <p className="text-[10px] text-slate-500 truncate mt-1">{face.location}</p>
            </div>
        </div>
    );
};

// Face List Item Component (List View)
const FaceListItem: React.FC<{ face: Suspect; onView: () => void }> = ({ face, onView }) => {
    const getDomain = (url: string) => {
        try { return new URL(url).hostname.replace('www.', ''); } catch { return url; }
    };

    return (
        <div onClick={onView} className="bg-eagle-800 border border-eagle-700 rounded-lg p-3 flex items-center space-x-4 cursor-pointer hover:border-purple-500 transition-all">
            <div className="w-16 h-16 rounded-lg bg-eagle-950 overflow-hidden shrink-0">
                <img src={face.imageUrl} alt={face.name} className="w-full h-full object-cover" />
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2">
                    <h3 className="text-sm font-bold text-white truncate">{face.name}</h3>
                    <span className="px-2 py-0.5 bg-purple-900/50 text-purple-300 text-[10px] rounded font-mono">{getDomain(face.sourceUrl)}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1 truncate">{face.location}</p>
                <div className="flex items-center space-x-3 mt-2 text-[10px] text-slate-600">
                    <span className="flex items-center"><Hash size={10} className="mr-1" />{face.faceToken.slice(0, 12)}...</span>
                    {face.coordinates && <span className="flex items-center"><MapPin size={10} className="mr-1" />{face.coordinates.lat.toFixed(2)}, {face.coordinates.lng.toFixed(2)}</span>}
                </div>
            </div>
            <button className="p-2 bg-eagle-900 hover:bg-purple-600 rounded text-slate-400 hover:text-white transition-colors"><Eye size={16} /></button>
        </div>
    );
};

// Face Detail Modal with direct image link
const FaceDetailModal: React.FC<{ face: Suspect; onClose: () => void }> = ({ face, onClose }) => {
    const getDomain = (url: string) => {
        try { return new URL(url).hostname; } catch { return url; }
    };

    const handleDownload = async () => {
        try {
            const response = await fetch(face.imageUrl);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${face.name.replace(/\s+/g, '_')}_${face.faceToken.slice(0, 8)}.jpg`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (e) {
            console.error('Download failed:', e);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-eagle-800 border border-eagle-700 rounded-xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="relative h-56 bg-eagle-950">
                    <img src={face.imageUrl} alt={face.name} className="w-full h-full object-cover opacity-80" />
                    <div className="absolute inset-0 bg-gradient-to-t from-eagle-800 via-transparent to-transparent" />
                    <button onClick={onClose} className="absolute top-3 right-3 p-2 bg-eagle-900/80 hover:bg-eagle-800 rounded-full text-white"><X size={18} /></button>
                    <div className="absolute top-3 left-3 px-3 py-1 bg-purple-600 rounded-full text-xs font-bold text-white flex items-center">
                        <Globe size={12} className="mr-1" /> CRAWLED
                    </div>
                    <div className="absolute bottom-4 left-4 right-4">
                        <h2 className="text-2xl font-bold text-white">{face.name}</h2>
                        <a href={face.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-purple-300 hover:text-purple-200 flex items-center mt-1">
                            <ExternalLink size={12} className="mr-1" /> {getDomain(face.sourceUrl)}
                        </a>
                    </div>
                </div>

                {/* Details */}
                <div className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-eagle-900 rounded-lg p-3">
                            <div className="flex items-center text-slate-400 text-xs mb-1"><Hash size={12} className="mr-1" /> Face Token</div>
                            <p className="text-white font-mono text-sm truncate">{face.faceToken}</p>
                        </div>
                        <div className="bg-eagle-900 rounded-lg p-3">
                            <div className="flex items-center text-slate-400 text-xs mb-1"><Fingerprint size={12} className="mr-1" /> NIN</div>
                            <p className="text-white font-mono text-sm">{face.nin || 'N/A'}</p>
                        </div>
                        <div className="bg-eagle-900 rounded-lg p-3">
                            <div className="flex items-center text-slate-400 text-xs mb-1"><MapPin size={12} className="mr-1" /> Location</div>
                            <p className="text-white text-sm">{face.location}</p>
                        </div>
                        <div className="bg-eagle-900 rounded-lg p-3">
                            <div className="flex items-center text-slate-400 text-xs mb-1"><User size={12} className="mr-1" /> Status</div>
                            <p className="text-white text-sm">{face.status || 'UNKNOWN'}</p>
                        </div>
                        {face.coordinates && (
                            <div className="bg-eagle-900 rounded-lg p-3 col-span-2">
                                <div className="flex items-center text-slate-400 text-xs mb-1"><MapPin size={12} className="mr-1" /> GPS Coordinates</div>
                                <p className="text-white font-mono text-sm">{face.coordinates.lat.toFixed(6)}, {face.coordinates.lng.toFixed(6)}</p>
                            </div>
                        )}
                    </div>

                    {/* Source Info with Direct Links */}
                    <div className="bg-purple-900/20 border border-purple-700/50 rounded-lg p-4 space-y-4">
                        <div className="flex items-center text-purple-300 text-xs font-bold">
                            <Globe size={12} className="mr-1" /> SOURCE INFORMATION
                        </div>
                        
                        {/* Page URL - Go to exact page */}
                        <div>
                            <div className="text-[10px] text-slate-500 uppercase mb-1">Page URL (Go to source page)</div>
                            <a href={face.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-purple-200 hover:text-white break-all flex items-start group">
                                <ExternalLink size={14} className="mr-2 mt-0.5 shrink-0 group-hover:text-purple-400" />
                                <span className="underline underline-offset-2">{face.sourceUrl}</span>
                            </a>
                        </div>
                        
                        {/* Original Image URL - Direct link to image */}
                        {face.originalImageUrl && (
                            <div>
                                <div className="text-[10px] text-slate-500 uppercase mb-1">Original Image URL (Direct image link)</div>
                                <a href={face.originalImageUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-300 hover:text-white break-all flex items-start group">
                                    <ImageIcon size={14} className="mr-2 mt-0.5 shrink-0 group-hover:text-blue-400" />
                                    <span className="underline underline-offset-2">{face.originalImageUrl}</span>
                                </a>
                            </div>
                        )}

                        {/* Quick Actions for URLs */}
                        <div className="flex space-x-2 pt-2 border-t border-purple-700/30">
                            <a 
                                href={face.sourceUrl} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="flex-1 py-2 bg-purple-600/30 hover:bg-purple-600 border border-purple-500/50 rounded text-xs font-bold text-purple-200 hover:text-white flex items-center justify-center transition-colors"
                            >
                                <ExternalLink size={12} className="mr-2" /> Open Source Page
                            </a>
                            {face.originalImageUrl && (
                                <a 
                                    href={face.originalImageUrl} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="flex-1 py-2 bg-blue-600/30 hover:bg-blue-600 border border-blue-500/50 rounded text-xs font-bold text-blue-200 hover:text-white flex items-center justify-center transition-colors"
                                >
                                    <ImageIcon size={12} className="mr-2" /> View Original Image
                                </a>
                            )}
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex space-x-3 pt-2">
                        <button className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-bold text-white flex items-center justify-center">
                            <Eye size={14} className="mr-2" /> Use in Search
                        </button>
                        <button onClick={handleDownload} className="flex-1 py-2 bg-eagle-900 hover:bg-eagle-700 border border-eagle-700 rounded text-sm font-bold text-slate-300 flex items-center justify-center">
                            <Download size={14} className="mr-2" /> Download Image
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
