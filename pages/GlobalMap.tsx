
import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import { supabaseDb } from '../services/supabaseDb';
import { basemap } from '../services/mapConfig';
import { getCameras } from '../services/cameraService';
import { Suspect, Camera, CameraStatus } from '../types';
import { generateCameraMarkerHtml, generateCameraPopupHtml } from '../components/CameraMarker';
import { CameraFeedModal } from '../components/CameraFeedModal';
import { Target, Filter, Layers, Navigation, RefreshCw, Search, X, Eye, Fingerprint, MapPin, Calendar, Hash, BadgeAlert, FileText, User, Video } from 'lucide-react';

interface GlobalMapProps {
    onEditSuspect?: (suspect: Suspect) => void;
    compact?: boolean;
}

export const GlobalMap: React.FC<GlobalMapProps> = ({ onEditSuspect, compact = false }) => {
    const mapRef = useRef<HTMLDivElement>(null);
    const mapInstance = useRef<any>(null);
    const routeLineRef = useRef<any>(null);
    
    const [suspects, setSuspects] = useState<Suspect[]>([]);
    const [cameras, setCameras] = useState<Camera[]>([]);
    const [filter, setFilter] = useState<'ALL' | 'WANTED' | 'CUSTODY' | 'CLEARED' | 'CRAWLED'>('ALL');
    const [isSidebarOpen, setIsSidebarOpen] = useState(!compact);
    const [lastRefresh, setLastRefresh] = useState(new Date());
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedSuspect, setSelectedSuspect] = useState<Suspect | null>(null);
    const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null);
    const [showCameraFeed, setShowCameraFeed] = useState(false);
    const fittedCameras = useRef(false);
    const cameraMarkersRef = useRef<any[]>([]);
    const subjectMarkersRef = useRef<any[]>([]);
    const [mapViewport, setMapViewport] = useState({ lat: 9.0765, lng: 7.3986, zoom: 6 });

    // HQ Coordinates (Simulated Abuja)
    const HQ_COORDS: L.LatLngTuple = [9.0765, 7.3986];

    const loadData = async () => {
        try {
            const allSuspects = await supabaseDb.getSuspects();
            setSuspects(allSuspects);
            setLastRefresh(new Date());
        } catch (error) {
            console.error('Failed to load suspects:', error);
        }
    };

    const loadCameras = useCallback(async () => {
        try {
            const allCameras = await getCameras();
            setCameras(allCameras);
        } catch (error) {
            console.error('Failed to load cameras:', error);
        }
    }, []);

    // Initial Load & Auto Refresh
    useEffect(() => {
        loadData();
        loadCameras();
        const dataInterval = setInterval(loadData, 30000); // 30s refresh for suspects
        const cameraInterval = setInterval(loadCameras, 30000); // 30s refresh for camera status
        return () => {
            clearInterval(dataInterval);
            clearInterval(cameraInterval);
        };
    }, [loadCameras]);

    // Interactive Popup Logic (Delegation)
    useEffect(() => {
        const handlePopupClick = (e: any) => {
            const target = e.target as HTMLElement;
            // Handle "Update Profile"
            const editBtn = target.closest('.popup-edit-btn');
            if (editBtn && onEditSuspect) {
                const token = editBtn.getAttribute('data-token');
                const suspect = suspects.find(s => s.faceToken === token);
                if (suspect) onEditSuspect(suspect);
            }

            // Handle "Draw Route"
            const routeBtn = target.closest('.popup-route-btn');
            if (routeBtn && mapInstance.current) {
                const lat = parseFloat(routeBtn.getAttribute('data-lat') || '0');
                const lng = parseFloat(routeBtn.getAttribute('data-lng') || '0');
                
                if (routeLineRef.current) routeLineRef.current.remove();
                
                routeLineRef.current = L.polyline([HQ_COORDS, [lat, lng]], {
                    color: '#3b82f6',
                    weight: 3,
                    opacity: 0.7,
                    dashArray: '10, 10'
                }).addTo(mapInstance.current);
                
                mapInstance.current.fitBounds(routeLineRef.current.getBounds().pad(0.1));
            }

            // Handle "View Live Feed" for cameras
            const viewFeedBtn = target.closest('.camera-view-feed-btn');
            if (viewFeedBtn) {
                const cameraId = viewFeedBtn.getAttribute('data-camera-id');
                const camera = cameras.find(c => c.id === cameraId);
                if (camera) {
                    setSelectedCamera(camera);
                    setShowCameraFeed(true);
                }
            }
        };

        document.addEventListener('click', handlePopupClick);
        return () => document.removeEventListener('click', handlePopupClick);
    }, [suspects, cameras, onEditSuspect]);

    useEffect(() => {
        const container = mapRef.current;
        if (!container) return;

        // Initialize Map
        const map = L.map(container, {
            zoomControl: false,
            attributionControl: true
        }).setView(HQ_COORDS, 6);
        
        mapInstance.current = map;
        const updateViewport = () => {
            if (mapInstance.current !== map || !mapRef.current) return;
            const center = map.getCenter();
            setMapViewport({ lat: center.lat, lng: center.lng, zoom: map.getZoom() });
        };
        map.on('moveend zoomend', updateViewport);

        // Mapbox satellite tiles when configured; retain CARTO for other setups.
        L.tileLayer(basemap.url, basemap.options).addTo(map);

        L.control.zoom({ position: 'bottomright' }).addTo(map);

        // Plot HQ
        const hqIcon = L.divIcon({
            className: 'hq-icon',
            html: `<div class="relative flex items-center justify-center">
                    <div class="w-4 h-4 bg-blue-500 border-2 border-white rounded-full shadow-lg z-20"></div>
                    <div class="absolute w-12 h-12 bg-blue-500/20 rounded-full animate-ping"></div>
                   </div>`,
            iconSize: [20, 20]
        });
        L.marker(HQ_COORDS, { icon: hqIcon }).addTo(map).bindPopup("<strong>HQ: Abuja</strong><br>Operational Center");
        const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => map.invalidateSize({ pan: false }));
        observer?.observe(container);
        return () => {
            observer?.disconnect();
            fittedCameras.current = false;
            mapInstance.current = null;
            map.off('moveend zoomend', updateViewport);
            map.stop();
            map.remove();
            subjectMarkersRef.current = [];
            cameraMarkersRef.current = [];
            routeLineRef.current = null;
        };
    }, []);

    // Refresh overlays without destroying the basemap or interrupting its tiles.
    useEffect(() => {
        const map = mapInstance.current;
        if (!map) return;
        subjectMarkersRef.current.forEach(marker => marker.remove());
        subjectMarkersRef.current = [];

        // Filter Logic
        const displayedSuspects = suspects.filter(s => {
            if (!s.coordinates) return false;
            if (filter === 'WANTED') return s.status === 'WANTED';
            if (filter === 'CUSTODY') return s.status === 'IN_CUSTODY';
            if (filter === 'CLEARED') return s.status === 'CLEARED';
            if (filter === 'CRAWLED') return s.sourceUrl !== 'police_db' && s.sourceUrl !== 'Manual Enrollment';
            return true;
        });

        const markers: any[] = [];

        displayedSuspects.forEach(s => {
            if (!s.coordinates) return;
            const { lat, lng } = s.coordinates;

            // Styling based on Status
            let color = '#3b82f6';
            let borderColor = 'border-blue-500';
            
            if (s.status === 'WANTED') { color = '#ef4444'; borderColor = 'border-red-500'; }
            if (s.status === 'IN_CUSTODY') { color = '#f59e0b'; borderColor = 'border-amber-500'; }
            if (s.status === 'CLEARED') { color = '#10b981'; borderColor = 'border-green-500'; }

            const iconHtml = s.imageUrl 
                ? `<div class="relative group cursor-pointer transition-transform hover:scale-110 hover:z-50">
                        <div class="w-10 h-10 rounded-full border-2 ${borderColor} overflow-hidden bg-black shadow-[0_0_15px_${color}] relative z-10">
                            <img src="${s.imageUrl}" class="w-full h-full object-cover" />
                        </div>
                        <div class="absolute -bottom-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[6px]" style="border-top-color: ${color}"></div>
                    </div>`
                : `<div style="background-color: ${color}; width: 12px; height: 12px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 8px ${color};"></div>`;

            const icon = L.divIcon({
                className: 'custom-div-icon',
                html: iconHtml,
                iconSize: [40, 40],
                iconAnchor: [20, 44]
            });

            const marker = L.marker([lat, lng], { icon }).addTo(map);
            
            // Interactive Popup Content
            const popupContent = `
                <div style="min-width: 220px; font-family: 'JetBrains Mono', monospace;">
                    <div style="background: #0f172a; border-bottom: 2px solid ${color}; padding: 8px; margin: -1px -1px 8px -1px; border-radius: 4px 4px 0 0;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <strong style="color: white; font-size: 13px;">${s.name}</strong>
                            <span style="font-size: 10px; background:${color}; color:white; padding: 2px 4px; border-radius: 2px;">${s.status || 'UNK'}</span>
                        </div>
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <div style="width: 60px; height: 60px; background: black; border-radius: 4px; overflow: hidden; flex-shrink: 0; border:1px solid #334155;">
                            <img src="${s.imageUrl}" style="width: 100%; height: 100%; object-fit: cover;" />
                        </div>
                        <div style="flex: 1;">
                            <div style="font-size: 11px; color: #94a3b8; font-weight:bold; margin-bottom: 2px;">${s.crime}</div>
                            <div style="font-size: 10px; color: #64748b;">${s.location}</div>
                            <div style="font-size: 9px; color: #475569; margin-top: 4px;">ID: ${s.nin}</div>
                        </div>
                    </div>
                    <div style="margin-top: 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                        <button class="popup-route-btn" data-lat="${lat}" data-lng="${lng}" style="background: #1e293b; color: #60a5fa; border: 1px solid #334155; padding: 4px; font-size: 10px; cursor: pointer; border-radius: 2px; font-weight: bold;">
                            TRACE ROUTE
                        </button>
                        <button class="popup-edit-btn" data-token="${s.faceToken}" style="background: #1e293b; color: #ffffff; border: 1px solid #334155; padding: 4px; font-size: 10px; cursor: pointer; border-radius: 2px; font-weight: bold;">
                            UPDATE PROFILE
                        </button>
                    </div>
                </div>
            `;
            
            marker.bindPopup(popupContent);
            markers.push(marker);
        });
        subjectMarkersRef.current = markers;

        // Clear existing camera markers
        cameraMarkersRef.current.forEach(marker => marker.remove());
        cameraMarkersRef.current = [];

        // Plot Camera Markers
        cameras.forEach(camera => {
            const { lat, lng } = camera.coordinates;
            if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
            
            const cameraIcon = L.divIcon({
                className: 'camera-marker-icon',
                html: generateCameraMarkerHtml(camera, false),
                iconSize: [32, 32],
                iconAnchor: [16, 32]
            });

            const cameraMarker = L.marker([lat, lng], { icon: cameraIcon }).addTo(map);
            cameraMarker.bindPopup(generateCameraPopupHtml(camera));
            cameraMarkersRef.current.push(cameraMarker);
        });

        if (compact && cameraMarkersRef.current.length && !fittedCameras.current) {
            map.fitBounds(L.featureGroup(cameraMarkersRef.current).getBounds(), { padding: [48, 48], maxZoom: 15 });
            fittedCameras.current = true;
        }
        if (!compact && markers.length > 0 && !routeLineRef.current) {
            const group = L.featureGroup(markers);
            const width = mapRef.current?.clientWidth || 0;
            map.fitBounds(group.getBounds().pad(0.1), {
                paddingTopLeft: [width > 700 ? 270 : 60, 100],
                paddingBottomRight: [width > 1000 ? 250 : 60, 80]
            });
        }

    }, [suspects, cameras, filter, compact]);

    return (
        <div data-compact={compact} className="tactical-map w-full h-full relative rounded-lg overflow-hidden border shadow-2xl flex">
            
            {/* Suspect Detail Modal */}
            {selectedSuspect && (
                <SuspectDetailModal 
                    suspect={selectedSuspect} 
                    onClose={() => setSelectedSuspect(null)}
                    onLocate={() => {
                        if (selectedSuspect.coordinates && mapInstance.current) {
                            mapInstance.current.setView([selectedSuspect.coordinates.lat, selectedSuspect.coordinates.lng], 12);
                            setSelectedSuspect(null);
                        }
                    }}
                />
            )}

            {/* Left Sidebar Filter Panel */}
            <div data-open={isSidebarOpen} className={`map-layers-panel absolute z-20 bg-eagle-900/95 backdrop-blur border border-eagle-800 rounded-lg shadow-xl transition-all duration-300 flex flex-col ${isSidebarOpen ? '' : '!w-12 overflow-hidden'}`}>
                <div className="p-4 border-b border-eagle-800 flex justify-between items-center bg-eagle-950/50">
                    {isSidebarOpen ? (
                        <h2 className="text-white font-bold text-sm flex items-center">
                            <Layers className="text-blue-500 mr-2" size={16} /> INTEL LAYERS
                        </h2>
                    ) : (
                        <Layers className="text-blue-500 mx-auto cursor-pointer" size={20} onClick={() => setIsSidebarOpen(true)} />
                    )}
                    {isSidebarOpen && (
                        <button onClick={() => setIsSidebarOpen(false)} className="text-slate-500 hover:text-white">
                            <Filter size={14} />
                        </button>
                    )}
                </div>

                {isSidebarOpen && (
                    <div className="flex-1 overflow-y-auto flex flex-col">
                        {/* Search Input */}
                        <div className="p-3 border-b border-eagle-800">
                            <div className="relative">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                                <input 
                                    type="text"
                                    placeholder="Search by name, crime..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full bg-eagle-950 border border-eagle-700 rounded pl-9 pr-8 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                                />
                                {searchQuery && (
                                    <button 
                                        onClick={() => setSearchQuery('')}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                                    >
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Filter Options */}
                        <div className="p-4 space-y-2">
                            <FilterOption label="ALL SUBJECTS" count={suspects.length} active={filter === 'ALL'} onClick={() => setFilter('ALL')} color="bg-slate-600" />
                            <div className="h-px bg-eagle-800 my-2" />
                            <FilterOption label="WANTED (HVT)" count={suspects.filter(s => s.status === 'WANTED').length} active={filter === 'WANTED'} onClick={() => setFilter('WANTED')} color="bg-red-500" />
                            <FilterOption label="IN CUSTODY" count={suspects.filter(s => s.status === 'IN_CUSTODY').length} active={filter === 'CUSTODY'} onClick={() => setFilter('CUSTODY')} color="bg-amber-500" />
                            <FilterOption label="CLEARED" count={suspects.filter(s => s.status === 'CLEARED').length} active={filter === 'CLEARED'} onClick={() => setFilter('CLEARED')} color="bg-emerald-500" />
                            <div className="h-px bg-eagle-800 my-2" />
                            <FilterOption label="CRAWLED DATA" count={suspects.filter(s => s.sourceUrl !== 'police_db').length} active={filter === 'CRAWLED'} onClick={() => setFilter('CRAWLED')} color="bg-purple-500" />
                        </div>

                        {/* Search Results List */}
                        {searchQuery && (
                            <div className="flex-1 border-t border-eagle-800 overflow-y-auto">
                                <div className="p-2 bg-eagle-950/50 text-[10px] text-slate-500 uppercase font-bold">
                                    Search Results ({suspects.filter(s => 
                                        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                        s.crime.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                        s.location.toLowerCase().includes(searchQuery.toLowerCase())
                                    ).length})
                                </div>
                                <div className="p-2 space-y-1">
                                    {suspects
                                        .filter(s => 
                                            s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                            s.crime.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                            s.location.toLowerCase().includes(searchQuery.toLowerCase())
                                        )
                                        .map(s => (
                                            <SearchResultItem 
                                                key={s.faceToken} 
                                                suspect={s} 
                                                onLocate={() => {
                                                    if (s.coordinates && mapInstance.current) {
                                                        mapInstance.current.setView([s.coordinates.lat, s.coordinates.lng], 12);
                                                    }
                                                }}
                                                onViewDetails={() => setSelectedSuspect(s)}
                                            />
                                        ))
                                    }
                                    {suspects.filter(s => 
                                        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                        s.crime.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                        s.location.toLowerCase().includes(searchQuery.toLowerCase())
                                    ).length === 0 && (
                                        <div className="text-center text-slate-500 text-xs py-4">No matches found</div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
                
                {isSidebarOpen && (
                    <div className="p-4 bg-eagle-950/50 text-[10px] text-slate-500 border-t border-eagle-800">
                         <div className="flex justify-between items-center mb-1">
                             <span>AUTO-REFRESH</span>
                             <span className="text-green-500">ACTIVE</span>
                         </div>
                         <div className="flex items-center space-x-2">
                             <RefreshCw size={10} className="animate-spin" /> 
                             <span>Last: {lastRefresh.toLocaleTimeString()}</span>
                         </div>
                    </div>
                )}
            </div>

            <div ref={mapRef} className="lunar-operational-map flex-1 h-full bg-eagle-950 z-0" aria-label="Interactive operations map" />
            <div className="map-command-hud">
                <div><p className="ops-eyebrow">GEOSPATIAL INTELLIGENCE / NIGERIA</p><h1>Operational picture</h1></div>
                <div className="map-viewport">{Math.abs(mapViewport.lat).toFixed(4)}° {mapViewport.lat >= 0 ? 'N' : 'S'} / {Math.abs(mapViewport.lng).toFixed(4)}° {mapViewport.lng >= 0 ? 'E' : 'W'}<br/>ZOOM {mapViewport.zoom} / {suspects.filter(s => s.coordinates).length} GEOLOCATED SUBJECTS</div>
            </div>
            <div className="map-reticle" aria-hidden="true" />
            <aside className="map-object-panel" aria-label="Wanted subject overview">
                <div className="ops-panel-heading"><div><Target size={14}/><h2>Wanted subjects</h2></div><span>{suspects.filter(s => s.status === 'WANTED').length}</span></div>
                {suspects.filter(s => s.status === 'WANTED').slice(0, 4).map(suspect =>
                    <button className="map-object-row" key={suspect.faceToken} onClick={() => setSelectedSuspect(suspect)}>
                        {suspect.imageUrl ? <img src={suspect.imageUrl} alt=""/> : <User size={24} className="text-slate-400 shrink-0"/>}<div><strong>{suspect.name}</strong><span>{suspect.location || 'Location not recorded'}</span></div>
                    </button>)}
                {!suspects.some(s => s.status === 'WANTED') && <p className="ops-muted p-4">No wanted subjects in the loaded records.</p>}
            </aside>
            <div className="map-basemap-note">{basemap.url.includes('mapbox.com') ? 'MAPBOX SATELLITE + STREET LABELS' : 'CARTO DARK BASEMAP'} / SUBJECT LOCATIONS ARE STORED RECORDS</div>
            
            {/* Map Legend Overlay */}
            <div className="map-legend absolute z-10 bg-eagle-900/80 backdrop-blur p-3 rounded border text-[10px] font-mono text-slate-300">
                <div className="mb-2 text-[9px] text-slate-500 uppercase font-bold">Suspects</div>
                <div className="flex items-center space-x-3 mb-2">
                    <div className="flex items-center"><span className="w-2 h-2 rounded-full bg-red-500 mr-1"></span> Wanted</div>
                    <div className="flex items-center"><span className="w-2 h-2 rounded-full bg-amber-500 mr-1"></span> Custody</div>
                    <div className="flex items-center"><span className="w-2 h-2 rounded-full bg-blue-500 mr-1"></span> Other</div>
                </div>
                <div className="border-t border-eagle-700 pt-2">
                    <div className="mb-1 text-[9px] text-slate-500 uppercase font-bold">Cameras ({cameras.length})</div>
                    <div className="flex items-center space-x-3">
                        <div className="flex items-center"><Video size={10} className="text-green-500 mr-1" /> Online</div>
                        <div className="flex items-center"><Video size={10} className="text-red-500 mr-1" /> Offline</div>
                        <div className="flex items-center"><Video size={10} className="text-amber-500 mr-1" /> Maint.</div>
                    </div>
                </div>
            </div>

            {/* Camera Feed Modal */}
            {showCameraFeed && selectedCamera && (
                <CameraFeedModal 
                    camera={selectedCamera} 
                    onClose={() => {
                        setShowCameraFeed(false);
                        setSelectedCamera(null);
                    }} 
                />
            )}
        </div>
    );
};

const FilterOption = ({ label, count, active, onClick, color }: any) => (
    <button 
        onClick={onClick}
        className={`w-full flex justify-between items-center p-2 rounded text-xs transition-colors ${active ? 'bg-blue-900/40 border border-blue-500/50' : 'hover:bg-eagle-800 border border-transparent'}`}
    >
        <div className="flex items-center">
            <div className={`w-2 h-2 rounded-full mr-2 ${color}`}></div>
            <span className={`font-bold ${active ? 'text-white' : 'text-slate-400'}`}>{label}</span>
        </div>
        <span className="bg-eagle-950 px-1.5 py-0.5 rounded text-slate-500 font-mono">{count}</span>
    </button>
);

const SearchResultItem: React.FC<{ suspect: Suspect, onLocate: () => void, onViewDetails: () => void }> = ({ suspect, onLocate, onViewDetails }) => {
    const [showNoCoords, setShowNoCoords] = useState(false);
    const hasCoordinates = suspect.coordinates && suspect.coordinates.lat && suspect.coordinates.lng;
    
    const statusColors: Record<string, string> = {
        'WANTED': 'bg-red-500',
        'IN_CUSTODY': 'bg-amber-500',
        'CLEARED': 'bg-emerald-500',
        'DECEASED': 'bg-slate-500'
    };

    const handleLocate = () => {
        if (hasCoordinates) {
            onLocate();
        } else {
            setShowNoCoords(true);
            setTimeout(() => setShowNoCoords(false), 2000);
        }
    };

    return (
        <div className="bg-eagle-800/50 hover:bg-eagle-800 rounded transition-colors group relative">
            {/* No coordinates warning */}
            {showNoCoords && (
                <div className="absolute -top-8 left-0 right-0 bg-yellow-900/90 text-yellow-300 text-[10px] px-2 py-1 rounded text-center z-10">
                    No coordinates available
                </div>
            )}
            <div 
                onClick={handleLocate}
                className="flex items-center space-x-2 p-2 cursor-pointer"
            >
                <div className="w-8 h-8 rounded bg-black overflow-hidden border border-eagle-700 shrink-0 relative">
                    <img src={suspect.imageUrl} className="w-full h-full object-cover" alt={suspect.name} />
                    {!hasCoordinates && (
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                            <MapPin size={10} className="text-slate-500" />
                        </div>
                    )}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold text-white truncate">{suspect.name}</span>
                        <span className={`w-1.5 h-1.5 rounded-full ${statusColors[suspect.status || ''] || 'bg-slate-500'}`}></span>
                    </div>
                    <div className="text-[10px] text-slate-500 truncate">{suspect.crime}</div>
                    {!hasCoordinates && (
                        <div className="text-[9px] text-yellow-600">No location data</div>
                    )}
                </div>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <Navigation size={12} className={hasCoordinates ? "text-blue-400" : "text-slate-600"} />
                </div>
            </div>
            {/* Action Buttons */}
            <div className="flex border-t border-eagle-700 opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                    onClick={(e) => { e.stopPropagation(); handleLocate(); }}
                    className={`flex-1 py-1.5 text-[10px] font-bold flex items-center justify-center ${
                        hasCoordinates 
                            ? 'text-blue-400 hover:bg-blue-900/30' 
                            : 'text-slate-600 cursor-not-allowed'
                    }`}
                    disabled={!hasCoordinates}
                >
                    <MapPin size={10} className="mr-1" /> {hasCoordinates ? 'Locate' : 'No GPS'}
                </button>
                <button 
                    onClick={(e) => { e.stopPropagation(); onViewDetails(); }}
                    className="flex-1 py-1.5 text-[10px] font-bold text-emerald-400 hover:bg-emerald-900/30 flex items-center justify-center border-l border-eagle-700"
                >
                    <Eye size={10} className="mr-1" /> Details
                </button>
            </div>
        </div>
    );
};

// Suspect Detail Modal Component
const SuspectDetailModal: React.FC<{ suspect: Suspect, onClose: () => void, onLocate: () => void }> = ({ suspect, onClose, onLocate }) => {
    const statusColors: Record<string, string> = {
        'WANTED': 'bg-red-600 text-white',
        'IN_CUSTODY': 'bg-yellow-600 text-black',
        'CLEARED': 'bg-green-600 text-white',
        'DECEASED': 'bg-slate-600 text-white'
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
            <div 
                className="bg-eagle-800 border border-eagle-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* Header with Image */}
                <div className="relative h-48 bg-eagle-950">
                    <img src={suspect.imageUrl} alt={suspect.name} className="w-full h-full object-cover opacity-80" />
                    <div className="absolute inset-0 bg-gradient-to-t from-eagle-800 to-transparent" />
                    <button 
                        onClick={onClose}
                        className="absolute top-3 right-3 p-2 bg-eagle-900/80 hover:bg-eagle-800 rounded-full text-white transition-colors"
                    >
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

                {/* Details */}
                <div className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-eagle-900 rounded-lg p-3">
                            <div className="flex items-center text-slate-400 text-xs mb-1">
                                <Hash size={12} className="mr-1" /> Face Token
                            </div>
                            <p className="text-white font-mono text-sm truncate">{suspect.faceToken}</p>
                        </div>
                        <div className="bg-eagle-900 rounded-lg p-3">
                            <div className="flex items-center text-slate-400 text-xs mb-1">
                                <Fingerprint size={12} className="mr-1" /> NIN
                            </div>
                            <p className="text-white font-mono text-sm">{suspect.nin || 'N/A'}</p>
                        </div>
                        <div className="bg-eagle-900 rounded-lg p-3">
                            <div className="flex items-center text-slate-400 text-xs mb-1">
                                <MapPin size={12} className="mr-1" /> Location
                            </div>
                            <p className="text-white text-sm">{suspect.location}</p>
                        </div>
                        <div className="bg-eagle-900 rounded-lg p-3">
                            <div className="flex items-center text-slate-400 text-xs mb-1">
                                <User size={12} className="mr-1" /> Gender
                            </div>
                            <p className="text-white text-sm">{suspect.gender || 'Unknown'}</p>
                        </div>
                        {suspect.dob && (
                            <div className="bg-eagle-900 rounded-lg p-3">
                                <div className="flex items-center text-slate-400 text-xs mb-1">
                                    <Calendar size={12} className="mr-1" /> Date of Birth
                                </div>
                                <p className="text-white text-sm">{suspect.dob}</p>
                            </div>
                        )}
                        {suspect.coordinates && (
                            <div className="bg-eagle-900 rounded-lg p-3">
                                <div className="flex items-center text-slate-400 text-xs mb-1">
                                    <Target size={12} className="mr-1" /> Coordinates
                                </div>
                                <p className="text-white font-mono text-sm">{suspect.coordinates.lat.toFixed(4)}, {suspect.coordinates.lng.toFixed(4)}</p>
                            </div>
                        )}
                    </div>

                    {suspect.physicalMarks && (
                        <div className="bg-eagle-900 rounded-lg p-3">
                            <div className="flex items-center text-slate-400 text-xs mb-1">
                                <BadgeAlert size={12} className="mr-1" /> Physical Marks
                            </div>
                            <p className="text-white text-sm">{suspect.physicalMarks}</p>
                        </div>
                    )}

                    {suspect.notes && (
                        <div className="bg-eagle-900 rounded-lg p-3">
                            <div className="flex items-center text-slate-400 text-xs mb-1">
                                <FileText size={12} className="mr-1" /> Officer Notes
                            </div>
                            <p className="text-white text-sm">{suspect.notes}</p>
                        </div>
                    )}

                    <div className="text-xs text-slate-500 pt-2 border-t border-eagle-700">
                        Source: {suspect.sourceUrl}
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="p-4 bg-eagle-950 border-t border-eagle-800 flex justify-between">
                    {suspect.coordinates && (
                        <button 
                            onClick={onLocate}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-bold flex items-center"
                        >
                            <MapPin size={14} className="mr-2" /> Show on Map
                        </button>
                    )}
                    <button onClick={onClose} className="px-4 py-2 bg-eagle-800 hover:bg-eagle-700 text-white rounded text-sm font-bold ml-auto">
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

// CameraFeedModal is now imported from components/CameraFeedModal.tsx
