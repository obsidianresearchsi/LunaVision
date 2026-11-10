/**
 * CameraFeedModal Component
 * 
 * Displays a live video feed from a surveillance camera with controls
 * for fullscreen, snapshot capture, and handling offline states.
 * 
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, CameraStatus } from '../types';
import { DemoCameraScene, DemoSubject } from './DemoCameraScene';
import { 
  X, 
  Video, 
  VideoOff, 
  Maximize2, 
  Minimize2, 
  Camera as CameraIcon,
  MapPin,
  Clock,
  AlertTriangle
} from 'lucide-react';

interface CameraFeedModalProps {
  camera: Camera;
  onClose: () => void;
  onSnapshotCapture?: (snapshot: CapturedSnapshot) => void;
  demoSubject?: DemoSubject;
}

export interface CapturedSnapshot {
  id: string;
  cameraId: string;
  cameraName: string;
  imageDataUrl: string;
  timestamp: string;
  coordinates: { lat: number; lng: number };
  metadata: {
    cameraStatus: CameraStatus;
    streamUrl: string;
  };
}

// Status color mapping
const statusColors: Record<CameraStatus, { bg: string; text: string; border: string }> = {
  [CameraStatus.ONLINE]: { bg: 'bg-green-600', text: 'text-green-500', border: 'border-green-500' },
  [CameraStatus.RECORDING]: { bg: 'bg-blue-600', text: 'text-blue-500', border: 'border-blue-500' },
  [CameraStatus.OFFLINE]: { bg: 'bg-red-600', text: 'text-red-500', border: 'border-red-500' },
  [CameraStatus.MAINTENANCE]: { bg: 'bg-amber-600', text: 'text-amber-500', border: 'border-amber-500' },
};

export const CameraFeedModal: React.FC<CameraFeedModalProps> = ({ 
  camera, 
  onClose,
  onSnapshotCapture,
  demoSubject
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [snapshotFeedback, setSnapshotFeedback] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);


  const isOnline = camera.status === CameraStatus.ONLINE || camera.status === CameraStatus.RECORDING;
  const isDemo = camera.streamUrl.startsWith('demo://');
  const lastOnline = camera.lastOnline 
    ? new Date(camera.lastOnline).toLocaleString()
    : 'Never';

  // Update current time every second for timestamp display
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isFullscreen) {
          setIsFullscreen(false);
        } else {
          onClose();
        }
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      } else if (e.key === 's' || e.key === 'S') {
        captureSnapshot();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen, onClose]);

  // Toggle fullscreen mode
  const toggleFullscreen = useCallback(() => {
    if (!modalRef.current) return;

    if (!isFullscreen) {
      if (modalRef.current.requestFullscreen) {
        modalRef.current.requestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
    setIsFullscreen(!isFullscreen);
  }, [isFullscreen]);

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Capture snapshot from video feed
  const captureSnapshot = useCallback(() => {
    if (!isOnline) {
      setSnapshotFeedback('Cannot capture snapshot: Camera is offline');
      setTimeout(() => setSnapshotFeedback(null), 3000);
      return;
    }

    const timestamp = new Date().toISOString();
    const snapshot: CapturedSnapshot = {
      id: `snapshot-${camera.id}-${Date.now()}`,
      cameraId: camera.id,
      cameraName: camera.name,
      imageDataUrl: '', // Will be populated from canvas or placeholder
      timestamp,
      coordinates: camera.coordinates,
      metadata: {
        cameraStatus: camera.status,
        streamUrl: camera.streamUrl,
      },
    };

    // Try to capture from video element if available
    const demoCanvas = modalRef.current?.querySelector<HTMLCanvasElement>('.demo-camera-canvas');
    if (isDemo && demoCanvas) {
      snapshot.imageDataUrl = demoCanvas.toDataURL('image/jpeg', 0.9);
    } else if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        snapshot.imageDataUrl = canvas.toDataURL('image/jpeg', 0.9);
      }
    } else {
      // Generate placeholder snapshot for demo purposes
      snapshot.imageDataUrl = generatePlaceholderSnapshot(camera, timestamp);
    }

    // Trigger download
    downloadSnapshot(snapshot);

    // Notify parent component if callback provided
    if (onSnapshotCapture) {
      onSnapshotCapture(snapshot);
    }

    setSnapshotFeedback('Snapshot captured successfully!');
    setTimeout(() => setSnapshotFeedback(null), 3000);
  }, [camera, isOnline, isDemo, onSnapshotCapture]);


  // Generate placeholder snapshot image with camera info overlay
  const generatePlaceholderSnapshot = (cam: Camera, ts: string): string => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    
    if (ctx) {
      // Dark background
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Grid pattern
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      for (let i = 0; i < canvas.width; i += 40) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, canvas.height);
        ctx.stroke();
      }
      for (let i = 0; i < canvas.height; i += 40) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(canvas.width, i);
        ctx.stroke();
      }
      
      // Camera icon placeholder
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.arc(canvas.width / 2, canvas.height / 2 - 40, 50, 0, Math.PI * 2);
      ctx.fill();
      
      // Text overlay
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 18px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(cam.name, canvas.width / 2, canvas.height / 2 + 40);
      
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px monospace';
      ctx.fillText(`Snapshot captured at ${new Date(ts).toLocaleString()}`, canvas.width / 2, canvas.height / 2 + 65);
      ctx.fillText(`Location: ${cam.coordinates.lat.toFixed(4)}, ${cam.coordinates.lng.toFixed(4)}`, canvas.width / 2, canvas.height / 2 + 85);
      
      // Timestamp bar at bottom
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(0, canvas.height - 30, canvas.width, 30);
      ctx.fillStyle = '#ffffff';
      ctx.font = '11px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${cam.name} | ${new Date(ts).toLocaleString()}`, 10, canvas.height - 10);
    }
    
    return canvas.toDataURL('image/jpeg', 0.9);
  };

  // Download snapshot as file
  const downloadSnapshot = (snapshot: CapturedSnapshot) => {
    const link = document.createElement('a');
    const filename = `${snapshot.cameraName.replace(/\s+/g, '_')}_${new Date(snapshot.timestamp).toISOString().replace(/[:.]/g, '-')}.jpg`;
    link.download = filename;
    link.href = snapshot.imageDataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const statusStyle = statusColors[camera.status] || statusColors[CameraStatus.OFFLINE];

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" 
      onClick={onClose}
    >
      <div 
        ref={modalRef}
        className={`bg-eagle-900 border border-eagle-700 rounded-xl shadow-2xl overflow-hidden transition-all duration-300 ${
          isFullscreen ? 'w-full h-full rounded-none' : 'w-full max-w-4xl mx-4'
        }`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-eagle-950 border-b border-eagle-700 p-4 flex justify-between items-center">
          <div className="flex items-center space-x-3">
            {isOnline ? (
              <Video size={20} className={statusStyle.text} />
            ) : (
              <VideoOff size={20} className={statusStyle.text} />
            )}
            <div>
              <h2 className="text-lg font-bold text-white">{camera.name}</h2>
              {camera.description && (
                <p className="text-xs text-slate-400">{camera.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${statusStyle.bg} text-white`}>
              {camera.status}
            </span>
            <button 
              onClick={onClose}
              className="p-2 bg-eagle-800 hover:bg-eagle-700 rounded-lg text-white transition-colors"
              title="Close (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>


        {/* Video Feed Area */}
        <div className={`relative bg-black ${isFullscreen ? 'flex-1' : 'aspect-video'}`}>
          {isOnline ? (
            <div className="w-full h-full relative">
              {/* Video element for actual stream - would use HLS.js or similar in production */}
              {isDemo ? <DemoCameraScene camera={camera} hasDetection={!!demoSubject} subject={demoSubject}/> : <video 
                ref={videoRef}
                className="w-full h-full object-contain"
                autoPlay
                muted
                playsInline
              >
                {/* In production, this would be connected to the actual stream URL */}
                <source src={camera.streamUrl} type="application/x-mpegURL" />
              </video>}
              
              {/* Placeholder when video not loaded */}
              {!isDemo && <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="relative">
                    <Video size={64} className="text-green-500 mx-auto animate-pulse" />
                    <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-ping" />
                  </div>
                  <p className="text-white text-sm mt-4 font-medium">Live Feed Active</p>
                  <p className="text-slate-500 text-xs mt-1 font-mono">{camera.streamUrl}</p>
                  <p className="text-slate-600 text-xs mt-2">
                    Stream integration requires HLS.js or similar player
                  </p>
                </div>
              </div>}

              {/* Recording indicator */}
              {camera.status === CameraStatus.RECORDING && (
                <div className="absolute top-4 left-4 flex items-center space-x-2 bg-black/70 px-3 py-1.5 rounded">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  <span className="text-red-500 text-xs font-bold">REC</span>
                </div>
              )}
            </div>
          ) : (
            /* Offline State Display */
            <div className="w-full h-full flex items-center justify-center min-h-[300px]">
              <div className="text-center">
                <div className="relative inline-block">
                  <VideoOff size={64} className="text-red-500 mx-auto" />
                  <AlertTriangle size={24} className="text-amber-500 absolute -bottom-1 -right-1" />
                </div>
                <p className="text-red-400 text-lg font-bold mt-4">Camera Offline</p>
                <p className="text-slate-500 text-sm mt-2">
                  Unable to connect to camera feed
                </p>
                <div className="mt-4 bg-eagle-900/50 rounded-lg p-3 inline-block">
                  <div className="flex items-center space-x-2 text-slate-400 text-xs">
                    <Clock size={14} />
                    <span>Last online: <span className="text-white font-mono">{lastOnline}</span></span>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {/* Timestamp Overlay */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
            <div className="flex justify-between items-end">
              <div className="text-white font-mono text-sm">
                {currentTime.toLocaleString()}
              </div>
              <div className="flex items-center space-x-1 text-slate-400 text-xs">
                <MapPin size={12} />
                <span>{camera.coordinates.lat.toFixed(4)}, {camera.coordinates.lng.toFixed(4)}</span>
              </div>
            </div>
          </div>

          {/* Snapshot feedback overlay */}
          {snapshotFeedback && (
            <div className={`absolute top-4 right-4 px-4 py-2 rounded-lg text-sm font-medium ${
              snapshotFeedback.includes('success') 
                ? 'bg-green-600 text-white' 
                : 'bg-red-600 text-white'
            }`}>
              {snapshotFeedback}
            </div>
          )}
        </div>

        {/* Hidden canvas for snapshot capture */}
        <canvas ref={canvasRef} className="hidden" />


        {/* Controls Bar */}
        <div className="bg-eagle-950 border-t border-eagle-700 p-4">
          <div className="flex justify-between items-center">
            {/* Camera Info */}
            <div className="flex items-center space-x-6 text-xs">
              <div>
                <span className="text-slate-500">Camera ID:</span>
                <span className="text-white ml-2 font-mono">{camera.id.slice(0, 8)}...</span>
              </div>
              <div>
                <span className="text-slate-500">Location:</span>
                <span className="text-white ml-2">
                  {camera.coordinates.lat.toFixed(4)}, {camera.coordinates.lng.toFixed(4)}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Last Online:</span>
                <span className="text-white ml-2">{lastOnline}</span>
              </div>
            </div>

            {/* Control Buttons */}
            <div className="flex items-center space-x-2">
              {/* Snapshot Button */}
              <button
                onClick={captureSnapshot}
                disabled={!isOnline}
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isOnline
                    ? 'bg-blue-600 hover:bg-blue-500 text-white'
                    : 'bg-eagle-800 text-slate-500 cursor-not-allowed'
                }`}
                title="Capture Snapshot (S)"
              >
                <CameraIcon size={16} />
                <span>Snapshot</span>
              </button>

              {/* Fullscreen Toggle */}
              <button
                onClick={toggleFullscreen}
                className="flex items-center space-x-2 px-4 py-2 bg-eagle-800 hover:bg-eagle-700 text-white rounded-lg text-sm font-medium transition-colors"
                title={isFullscreen ? 'Exit Fullscreen (F)' : 'Fullscreen (F)'}
              >
                {isFullscreen ? (
                  <>
                    <Minimize2 size={16} />
                    <span>Exit Fullscreen</span>
                  </>
                ) : (
                  <>
                    <Maximize2 size={16} />
                    <span>Fullscreen</span>
                  </>
                )}
              </button>

              {/* Close Button */}
              <button
                onClick={onClose}
                className="flex items-center space-x-2 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg text-sm font-medium transition-colors"
                title="Close (Esc)"
              >
                <X size={16} />
                <span>Close</span>
              </button>
            </div>
          </div>

          {/* Keyboard shortcuts hint */}
          <div className="mt-3 pt-3 border-t border-eagle-800 flex justify-center space-x-6 text-[10px] text-slate-600">
            <span><kbd className="px-1.5 py-0.5 bg-eagle-800 rounded text-slate-400">S</kbd> Snapshot</span>
            <span><kbd className="px-1.5 py-0.5 bg-eagle-800 rounded text-slate-400">F</kbd> Fullscreen</span>
            <span><kbd className="px-1.5 py-0.5 bg-eagle-800 rounded text-slate-400">Esc</kbd> Close</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CameraFeedModal;
