/**
 * SurveillanceDashboard Page
 * 
 * Multi-screen camera feed monitoring dashboard with grid layouts.
 * Supports 2x2, 3x3, 4x4 layout options and camera selection.
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Camera, CameraStatus, Detection } from '../types';
import { getCameras } from '../services/cameraService';
import { getRecentDetections } from '../services/detectionService';
import { CameraFeedCard } from '../components/CameraFeedCard';
import { CameraFeedModal } from '../components/CameraFeedModal';
import {
  Grid,
  Settings,
  RefreshCw,
  Video,
  VideoOff,
  AlertTriangle,
  Check,
  X,
  Play,
  Square
} from 'lucide-react';
import { 
  startDemoSimulation, 
  stopDemoSimulation, 
  isSimulationRunning,
  getDemoCameras,
  generateRandomDetection,
  SimulatedAlert
} from '../services/demoSimulation';
import { DetectionAlertPopup } from '../components/DetectionAlertPopup';
import { OperationsHeader, OperationsMetrics } from '../components/OperationsUI';

// Layout options
type LayoutType = '2x2' | '3x3' | '4x4';

const LAYOUT_CONFIG: Record<LayoutType, { cols: number; maxCameras: number }> = {
  '2x2': { cols: 2, maxCameras: 4 },
  '3x3': { cols: 3, maxCameras: 9 },
  '4x4': { cols: 4, maxCameras: 16 }
};

// Local storage key for persisting camera selection
const STORAGE_KEY = 'surveillance_dashboard_selection';

interface StoredSelection {
  layout: LayoutType;
  selectedCameraIds: string[];
}

export const SurveillanceDashboard: React.FC = () => {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [layout, setLayout] = useState<LayoutType>('2x2');
  const [selectedCameraIds, setSelectedCameraIds] = useState<string[]>([]);
  const [recentDetections, setRecentDetections] = useState<Detection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCameraSelector, setShowCameraSelector] = useState(false);
  const [fullscreenCamera, setFullscreenCamera] = useState<Camera | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  
  // Demo mode state
  const [demoMode, setDemoMode] = useState(false);
  const [currentAlert, setCurrentAlert] = useState<SimulatedAlert | null>(null);
  const [demoCamerasWithDetections, setDemoCamerasWithDetections] = useState<Set<string>>(new Set());
  const [demoEvents, setDemoEvents] = useState<SimulatedAlert[]>([]);
  const demoModeRef = useRef(false);
  const previousSelection = useRef<StoredSelection | null>(null);
  const highlightTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // Load saved selection from local storage
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed: StoredSelection = JSON.parse(saved);
        setLayout(parsed.layout || '2x2');
        setSelectedCameraIds(parsed.selectedCameraIds || []);
      } catch {
        // Invalid stored data, use defaults
      }
    }
  }, []);

  // Handle demo mode toggle
  const toggleDemoMode = () => {
    if (demoMode) {
      // Stop demo
      stopDemoSimulation();
      demoModeRef.current = false;
      highlightTimers.current.forEach(clearTimeout);
      highlightTimers.current.clear();
      setDemoMode(false);
      setCurrentAlert(null);
      setDemoCamerasWithDetections(new Set());
      setDemoEvents([]);
      if (previousSelection.current) {
        setSelectedCameraIds(previousSelection.current.selectedCameraIds);
        setLayout(previousSelection.current.layout);
      }
      // Reload real cameras
      loadData();
    } else {
      // Start demo
      const demoCams = getDemoCameras();
      previousSelection.current = { layout, selectedCameraIds: [...selectedCameraIds] };
      demoModeRef.current = true;
      setLayout('2x2');
      setCameras(demoCams);
      setIsLoading(false);
      setSelectedCameraIds(demoCams.map(c => c.id));
      setDemoMode(true);
      
      startDemoSimulation(25000, (alert) => { // Detection every 25 seconds
        if (!demoModeRef.current) return;
        setCurrentAlert(alert);
        setDemoEvents(previous => [alert, ...previous].slice(0, 8));
        setDemoCamerasWithDetections(prev => new Set([...prev, alert.camera.id]));
        
        // Clear detection highlight after 8 seconds
        const previousTimer = highlightTimers.current.get(alert.camera.id);
        if (previousTimer) clearTimeout(previousTimer);
        highlightTimers.current.set(alert.camera.id, setTimeout(() => {
          setDemoCamerasWithDetections(prev => {
            const next = new Set(prev);
            next.delete(alert.camera.id);
            return next;
          });
          highlightTimers.current.delete(alert.camera.id);
        }, 8000));
      });
    }
  };

  // Cleanup demo on unmount
  useEffect(() => {
    return () => {
      demoModeRef.current = false;
      highlightTimers.current.forEach(clearTimeout);
      highlightTimers.current.clear();
      if (isSimulationRunning()) {
        stopDemoSimulation();
      }
    };
  }, []);


  // Save selection to local storage
  const saveSelection = useCallback((newLayout: LayoutType, newIds: string[]) => {
    if (demoModeRef.current) return;
    const selection: StoredSelection = {
      layout: newLayout,
      selectedCameraIds: newIds
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  }, []);

  // Load cameras and detections
  const loadData = useCallback(async () => {
    if (demoModeRef.current) return;
    try {
      const [camerasData, detectionsData] = await Promise.all([
        getCameras(),
        getRecentDetections(100)
      ]);
      if (demoModeRef.current) return;
      setCameras(camerasData);
      setRecentDetections(detectionsData);
      setLastRefresh(new Date());
    } catch (error) {
      console.error('Failed to load surveillance data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load and auto-refresh
  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [loadData]);

  // Handle layout change
  const handleLayoutChange = (newLayout: LayoutType) => {
    setLayout(newLayout);
    // Trim selected cameras if new layout has fewer slots
    const maxCameras = LAYOUT_CONFIG[newLayout].maxCameras;
    const trimmedIds = selectedCameraIds.slice(0, maxCameras);
    setSelectedCameraIds(trimmedIds);
    saveSelection(newLayout, trimmedIds);
  };

  // Handle camera selection toggle
  const toggleCameraSelection = (cameraId: string) => {
    const maxCameras = LAYOUT_CONFIG[layout].maxCameras;
    let newIds: string[];
    
    if (selectedCameraIds.includes(cameraId)) {
      newIds = selectedCameraIds.filter(id => id !== cameraId);
    } else if (selectedCameraIds.length < maxCameras) {
      newIds = [...selectedCameraIds, cameraId];
    } else {
      return; // Max cameras reached
    }
    
    setSelectedCameraIds(newIds);
    saveSelection(layout, newIds);
  };

  // Get cameras with recent detections (use demo detections in demo mode)
  const camerasWithDetections = demoMode 
    ? demoCamerasWithDetections 
    : new Set(recentDetections.map(d => d.cameraId));

  // Get selected cameras in order
  const selectedCameras = selectedCameraIds
    .map(id => cameras.find(c => c.id === id))
    .filter((c): c is Camera => c !== undefined);

  // Stats
  const onlineCameras = cameras.filter(c => c.status === CameraStatus.ONLINE || c.status === CameraStatus.RECORDING).length;
  const offlineCameras = cameras.filter(c => c.status === CameraStatus.OFFLINE).length;

  const { cols } = LAYOUT_CONFIG[layout];
  const demoSubjectFor = (cameraId: string) => {
    const event = demoEvents.find(item => item.camera.id === cameraId);
    return event ? { name: event.poi.name, imageUrl: event.poi.imageUrl, confidence: event.detection.confidence } : undefined;
  };

  return (
    <div className="ops-page min-h-full flex flex-col" data-accent="amber">
      {/* Header */}
      <OperationsHeader code="OBSERVATION / CAMERA OPERATIONS" title="Live cameras"
        description="Camera coverage, monitoring workspaces, and recorded detections."
        icon={<Video />} actions={<div className="ops-heading-actions">
          {/* Stats */}
          <div className="flex items-center space-x-4 mr-4 text-sm">
            <div className="flex items-center text-green-500">
              <Video size={16} className="mr-1" />
              <span>{onlineCameras} Online</span>
            </div>
            <div className="flex items-center text-red-500">
              <VideoOff size={16} className="mr-1" />
              <span>{offlineCameras} Offline</span>
            </div>
          </div>

          {/* Layout Selector */}
          <div className="flex items-center bg-eagle-800 rounded-lg p-1">
            {(['2x2', '3x3', '4x4'] as LayoutType[]).map((l) => (
              <button
                key={l}
                onClick={() => handleLayoutChange(l)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                  layout === l
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          {/* Demo Mode Toggle */}
          <button
            onClick={toggleDemoMode}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${
              demoMode 
                ? 'bg-amber-600 hover:bg-amber-500 text-white' 
                : 'bg-purple-600 hover:bg-purple-500 text-white'
            }`}
            title={demoMode ? 'Stop Demo' : 'Start Demo Mode'}
          >
            {demoMode ? <Square size={16} /> : <Play size={16} />}
            <span className="text-sm">{demoMode ? 'Stop Demo' : 'Demo Mode'}</span>
          </button>

          {/* Camera Selector Button */}
          <button
            onClick={() => setShowCameraSelector(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-eagle-800 hover:bg-eagle-700 text-white rounded-lg transition-colors"
            disabled={demoMode}
          >
            <Settings size={16} />
            <span className="text-sm">Select Cameras</span>
          </button>

          {/* Refresh Button */}
          <button
            onClick={loadData}
            className="p-2 bg-eagle-800 hover:bg-eagle-700 text-white rounded-lg transition-colors"
            title="Refresh feeds"
            disabled={demoMode}
          >
            <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      } />
      <OperationsMetrics items={[
        { label: 'Registered cameras', value: isLoading ? '—' : cameras.length, detail: demoMode ? 'Simulated camera set' : 'Configured inventory' },
        { label: 'Online / recording', value: isLoading ? '—' : onlineCameras, detail: 'Reported camera status', tone: 'green' },
        { label: 'Offline cameras', value: isLoading ? '—' : offlineCameras, tone: 'red' },
        { label: 'Workspace', value: layout, detail: `${selectedCameras.length} selected · ${demoMode ? 'Demo mode' : 'Standard mode'}`, tone: 'amber' }
      ]} />

      {/* Demo Mode Banner */}
      {demoMode && (
        <div className="demo-workspace-banner">
          <div><p>LOCAL SIMULATION / NIGERIA</p><h2>Demo Mode Active</h2><span>Four synthetic scenes · fictional African identities · no live recognition</span></div>
          <div className="demo-identity-stack" aria-label="Fictional demo portraits">{['01', '02', '03'].map(id => <img key={id} src={`/demo/subject-${id}.jpg`} alt={`Fictional African demo subject ${id}`}/>)}</div>
          <div className="demo-workspace-timing"><span>First alert ~8s / recurring ~25s</span><button onClick={() => generateRandomDetection()}><AlertTriangle size={13}/>Trigger demo alert</button></div>
        </div>
      )}


      {/* Camera Grid */}
      <div className="surveillance-workspace">
      <div className="surveillance-streams">
      <div className="surveillance-grid flex-1 min-h-0">
        {selectedCameras.length === 0 ? (
          <div className="h-full flex items-center justify-center bg-eagle-900/50 rounded-xl border border-eagle-800">
            <div className="text-center">
              <Grid size={64} className="text-slate-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-slate-400 mb-2">No Cameras Selected</h3>
              <p className="text-slate-500 text-sm mb-4">
                Select cameras to display in the surveillance grid
              </p>
              <button
                onClick={() => setShowCameraSelector(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
              >
                Select Cameras
              </button>
            </div>
          </div>
        ) : (
          <div
            className="grid gap-3 h-full"
            style={{
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              gridTemplateRows: `repeat(${cols}, minmax(180px, 1fr))`
            }}
          >
            {selectedCameras.map((camera) => (
              <CameraFeedCard
                key={camera.id}
                camera={camera}
                hasRecentDetection={camerasWithDetections.has(camera.id)}
                onExpand={() => setFullscreenCamera(camera)}
                demoMode={demoMode}
                demoSubject={demoMode ? demoSubjectFor(camera.id) : undefined}
              />
            ))}
            {/* Empty slots */}
            {Array.from({ length: LAYOUT_CONFIG[layout].maxCameras - selectedCameras.length }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className="bg-eagle-900/30 rounded-lg border border-dashed border-eagle-700 flex items-center justify-center cursor-pointer hover:border-eagle-600 transition-colors"
                onClick={() => setShowCameraSelector(true)}
              >
                <div className="text-center text-slate-600">
                  <Video size={32} className="mx-auto mb-2 opacity-50" />
                  <span className="text-xs">Click to add camera</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="history-ledger-note mt-3">{demoMode ? 'Demo feeds and events are simulated.' : 'Camera status reflects stored records. Grid previews are placeholders; open a camera to inspect its configured stream.'}</div>
      </div>
      <aside className="ops-panel surveillance-feed" aria-label="Recent detection records">
        <div className="ops-panel-heading"><div><AlertTriangle size={15}/><h2>{demoMode ? 'Simulation events' : 'Detection records'}</h2></div><span>{demoMode ? demoEvents.length : recentDetections.length}</span></div>
        {demoMode ? (demoEvents.length ? demoEvents.map(event => <button className="demo-event-row" key={event.alert.id} onClick={() => setCurrentAlert(event)}>
          {event.poi.imageUrl && <img src={event.poi.imageUrl} alt="Fictional demo portrait"/>}<div><span>{new Date(event.alert.createdAt).toLocaleTimeString()} / DEMO</span><strong>{event.poi.name}</strong><p>{event.camera.name}<br/>{(event.detection.confidence * 100).toFixed(1)}% simulated score</p></div>
        </button>) : <div className="surveillance-event"><strong>Awaiting first demo event</strong><p>An alert arrives after about 8 seconds. You can also trigger one using the demo control.</p></div>) : recentDetections.length === 0 ? <div className="surveillance-event"><strong>No detections loaded</strong><p>Recorded detections appear here after they are available.</p></div> : recentDetections.slice(0, 8).map(detection =>
          <div className="surveillance-event" key={detection.id}>
            <span>{new Date(detection.detectedAt).toLocaleTimeString()}</span>
            <strong>{cameras.find(camera => camera.id === detection.cameraId)?.name || detection.cameraId}</strong>
            <p>POI / {detection.poiId}<br/>{(detection.confidence * 100).toFixed(1)}% recorded confidence</p>
          </div>)}
      </aside>
      </div>

      {/* Last Refresh Info */}
      <div className="mt-3 text-xs text-slate-500 flex items-center justify-between">
        <span>
          Showing {selectedCameras.length} of {cameras.length} cameras
        </span>
        <span className="flex items-center">
          <RefreshCw size={12} className="mr-1" />
          Last updated: {lastRefresh.toLocaleTimeString()}
        </span>
      </div>

      {/* Camera Selector Modal */}
      {showCameraSelector && (
        <CameraSelectorModal
          cameras={cameras}
          selectedIds={selectedCameraIds}
          maxCameras={LAYOUT_CONFIG[layout].maxCameras}
          camerasWithDetections={camerasWithDetections}
          onToggle={toggleCameraSelection}
          onClose={() => setShowCameraSelector(false)}
        />
      )}

      {/* Fullscreen Camera Modal */}
      {fullscreenCamera && (
        <CameraFeedModal
          camera={fullscreenCamera}
          demoSubject={demoMode ? demoSubjectFor(fullscreenCamera.id) : undefined}
          onClose={() => setFullscreenCamera(null)}
        />
      )}

      {/* Demo Detection Alert Popup */}
      {currentAlert && demoMode && (
        <DetectionAlertPopup
          alert={{
            ...currentAlert.alert,
            poi: currentAlert.poi,
            detection: currentAlert.detection,
            cameraName: currentAlert.camera.name
          }}
          onClose={() => setCurrentAlert(null)}
          onViewFeed={(cameraId) => {
            const cam = cameras.find(c => c.id === cameraId);
            if (cam) setFullscreenCamera(cam);
            setCurrentAlert(null);
          }}
          playSound={true}
        />
      )}
    </div>
  );
};

// Camera Selector Modal Component
interface CameraSelectorModalProps {
  cameras: Camera[];
  selectedIds: string[];
  maxCameras: number;
  camerasWithDetections: Set<string>;
  onToggle: (cameraId: string) => void;
  onClose: () => void;
}

const CameraSelectorModal: React.FC<CameraSelectorModalProps> = ({
  cameras,
  selectedIds,
  maxCameras,
  camerasWithDetections,
  onToggle,
  onClose
}) => {
  const [filter, setFilter] = useState<'all' | 'online' | 'offline'>('all');
  const [search, setSearch] = useState('');

  const filteredCameras = cameras.filter(camera => {
    // Status filter
    if (filter === 'online' && camera.status !== CameraStatus.ONLINE && camera.status !== CameraStatus.RECORDING) {
      return false;
    }
    if (filter === 'offline' && camera.status !== CameraStatus.OFFLINE) {
      return false;
    }
    // Search filter
    if (search && !camera.name.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-eagle-900 border border-eagle-700 rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-eagle-700 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-white">Select Cameras</h2>
            <p className="text-sm text-slate-400">
              {selectedIds.length} of {maxCameras} cameras selected
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-eagle-800 rounded-lg text-slate-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>


        {/* Filters */}
        <div className="p-4 border-b border-eagle-800 flex items-center space-x-4">
          <input
            type="text"
            placeholder="Search cameras..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-eagle-950 border border-eagle-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
          <div className="flex items-center bg-eagle-800 rounded-lg p-1">
            {(['all', 'online', 'offline'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-xs font-medium rounded capitalize transition-colors ${
                  filter === f
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Camera List */}
        <div className="flex-1 overflow-y-auto p-4">
          {filteredCameras.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              No cameras found
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {filteredCameras.map(camera => {
                const isSelected = selectedIds.includes(camera.id);
                const isOnline = camera.status === CameraStatus.ONLINE || camera.status === CameraStatus.RECORDING;
                const hasDetection = camerasWithDetections.has(camera.id);
                const canSelect = isSelected || selectedIds.length < maxCameras;

                return (
                  <button
                    key={camera.id}
                    onClick={() => canSelect && onToggle(camera.id)}
                    disabled={!canSelect}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      isSelected
                        ? 'bg-blue-600/20 border-blue-500'
                        : canSelect
                        ? 'bg-eagle-800/50 border-eagle-700 hover:border-eagle-600'
                        : 'bg-eagle-800/30 border-eagle-800 opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        <div className={`p-2 rounded-lg ${isOnline ? 'bg-green-600/20' : 'bg-red-600/20'}`}>
                          {isOnline ? (
                            <Video size={18} className="text-green-500" />
                          ) : (
                            <VideoOff size={18} className="text-red-500" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-medium text-white text-sm">{camera.name}</span>
                            {hasDetection && (
                              <span title="Recent POI detection">
                                <AlertTriangle size={14} className="text-amber-500" />
                              </span>
                            )}
                          </div>
                          <span className={`text-xs ${isOnline ? 'text-green-500' : 'text-red-500'}`}>
                            {camera.status}
                          </span>
                        </div>
                      </div>
                      <div className={`w-5 h-5 rounded border flex items-center justify-center ${
                        isSelected
                          ? 'bg-blue-600 border-blue-500'
                          : 'border-eagle-600'
                      }`}>
                        {isSelected && <Check size={14} className="text-white" />}
                      </div>
                    </div>
                    {camera.description && (
                      <p className="text-xs text-slate-500 mt-2 truncate">{camera.description}</p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-eagle-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default SurveillanceDashboard;
