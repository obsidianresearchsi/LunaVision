/**
 * CameraFeedCard Component
 * 
 * Displays an individual camera feed in the surveillance dashboard grid.
 * Shows camera name, status indicator, and highlights recent detections.
 * Supports demo mode with simulated video feed animation.
 * 
 * Requirements: 5.3, 5.4, 5.5
 */

import React, { useState, useEffect } from 'react';
import { Camera, CameraStatus } from '../types';
import { DemoCameraScene, DemoSubject } from './DemoCameraScene';
import {
  Video,
  VideoOff,
  Maximize2,
  AlertTriangle,
  MapPin,
  Clock
} from 'lucide-react';

interface CameraFeedCardProps {
  camera: Camera;
  hasRecentDetection?: boolean;
  onExpand: () => void;
  demoMode?: boolean;
  demoSubject?: DemoSubject;
}

// Status color mapping
const statusConfig: Record<CameraStatus, { 
  bg: string; 
  text: string; 
  border: string;
  indicator: string;
  label: string;
}> = {
  [CameraStatus.ONLINE]: { 
    bg: 'bg-green-600/20', 
    text: 'text-green-500', 
    border: 'border-green-500/30',
    indicator: 'bg-green-500',
    label: 'LIVE'
  },
  [CameraStatus.RECORDING]: { 
    bg: 'bg-blue-600/20', 
    text: 'text-blue-500', 
    border: 'border-blue-500/30',
    indicator: 'bg-blue-500',
    label: 'REC'
  },
  [CameraStatus.OFFLINE]: { 
    bg: 'bg-red-600/20', 
    text: 'text-red-500', 
    border: 'border-red-500/30',
    indicator: 'bg-red-500',
    label: 'OFFLINE'
  },
  [CameraStatus.MAINTENANCE]: { 
    bg: 'bg-amber-600/20', 
    text: 'text-amber-500', 
    border: 'border-amber-500/30',
    indicator: 'bg-amber-500',
    label: 'MAINT'
  }
};

export const CameraFeedCard: React.FC<CameraFeedCardProps> = ({
  camera,
  hasRecentDetection = false,
  onExpand,
  demoMode = false,
  demoSubject
}) => {
  const [currentTime, setCurrentTime] = useState(new Date());
  
  const isOnline = camera.status === CameraStatus.ONLINE || camera.status === CameraStatus.RECORDING;
  const config = statusConfig[camera.status] || statusConfig[CameraStatus.OFFLINE];
  const lastOnline = camera.lastOnline 
    ? new Date(camera.lastOnline).toLocaleString()
    : 'Never';

  // Update timestamp every second
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);



  return (
    <div 
      className={`camera-feed-card relative bg-eagle-900 rounded-lg border overflow-hidden group cursor-pointer transition-all hover:border-blue-500/50 ${
        hasRecentDetection 
          ? 'border-amber-500 ring-2 ring-amber-500/30' 
          : config.border
      }`}
      onClick={onExpand}
      role="button" tabIndex={0} aria-label={`Open camera ${camera.name}`}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onExpand?.(); } }}
    >
      {/* Detection Alert Indicator */}
      {hasRecentDetection && (
        <div className="absolute top-2 right-2 z-20 flex items-center space-x-1 bg-amber-600 text-white px-2 py-1 rounded text-xs font-bold animate-pulse">
          <AlertTriangle size={12} />
          <span>POI DETECTED</span>
        </div>
      )}

      {/* Video Feed Area */}
      <div className="aspect-video bg-black relative">
        {isOnline ? (
          <>
            {/* Demo mode: Animated canvas feed */}
            {demoMode ? (
              <DemoCameraScene camera={camera} hasDetection={hasRecentDetection} subject={demoSubject} />
            ) : (
              /* Simulated live feed placeholder */
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="camera-feed-reticle" aria-hidden="true" />
                <div className="camera-feed-placeholder text-center">
                  <Video size={40} className="text-green-500/50 mx-auto animate-pulse" />
                  <p className="text-slate-600 text-xs mt-2 font-mono">{camera.streamUrl}</p>
                  <p className="camera-feed-placeholder-status">PREVIEW UNAVAILABLE / OPEN CONFIGURED FEED</p>
                </div>
              </div>
            )}
            
            {/* Live indicator */}
            <div className="absolute top-2 left-2 flex items-center space-x-1.5 bg-black/70 px-2 py-1 rounded">
              <div className={`w-2 h-2 rounded-full ${config.indicator} animate-pulse`} />
              <span className={`text-xs font-bold ${config.text}`}>{demoMode ? 'DEMO' : config.label}</span>
            </div>

            {/* Recording indicator */}
            {camera.status === CameraStatus.RECORDING && (
              <div className="absolute top-2 right-2 flex items-center space-x-1 bg-black/70 px-2 py-1 rounded">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className="text-red-500 text-xs font-bold">REC</span>
              </div>
            )}
          </>
        ) : (
          /* Offline state */
          <div className="absolute inset-0 flex items-center justify-center bg-eagle-950">
            <div className="text-center">
              <VideoOff size={40} className="text-red-500/50 mx-auto" />
              <p className="text-red-400 text-xs mt-2 font-medium">Camera Offline</p>
              <div className="flex items-center justify-center space-x-1 text-slate-500 text-[10px] mt-1">
                <Clock size={10} />
                <span>Last: {lastOnline}</span>
              </div>
            </div>
          </div>
        )}

        {/* Timestamp overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
          <div className="flex justify-between items-end text-[10px] font-mono">
            <span className="text-white">{currentTime.toLocaleTimeString()}</span>
            <div className="flex items-center space-x-1 text-slate-400">
              <MapPin size={10} />
              <span>{camera.coordinates.lat.toFixed(2)}, {camera.coordinates.lng.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Expand button on hover */}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <span className="p-3 bg-blue-600 rounded-full text-white hover:bg-blue-500 transition-colors" aria-hidden="true">
            <Maximize2 size={20} />
          </span>
        </div>
      </div>

      {/* Camera Info Footer */}
      <div className="p-2 bg-eagle-950 border-t border-eagle-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 min-w-0">
            <div className={`p-1 rounded ${config.bg}`}>
              {isOnline ? (
                <Video size={14} className={config.text} />
              ) : (
                <VideoOff size={14} className={config.text} />
              )}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-white truncate">{camera.name}</h3>
              {camera.description && (
                <p className="text-[10px] text-slate-500 truncate">{camera.description}</p>
              )}
            </div>
          </div>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${config.bg} ${config.text}`}>
            {camera.status}
          </span>
        </div>
      </div>
    </div>
  );
};

export default CameraFeedCard;
