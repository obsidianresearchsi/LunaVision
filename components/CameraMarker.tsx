/**
 * CameraMarker Component
 * 
 * Displays a camera icon on the map with status-based coloring.
 * Shows tooltip on hover with camera name and location.
 */

import React from 'react';
import { Camera, CameraStatus } from '../types';
import { Video, VideoOff, Wrench, Circle } from 'lucide-react';

interface CameraMarkerProps {
  camera: Camera;
  onClick?: () => void;
  hasRecentDetection?: boolean;
}

// Get color based on camera status
export function getCameraStatusColor(status: CameraStatus): string {
  switch (status) {
    case CameraStatus.ONLINE:
      return '#22c55e'; // green-500
    case CameraStatus.RECORDING:
      return '#3b82f6'; // blue-500
    case CameraStatus.OFFLINE:
      return '#ef4444'; // red-500
    case CameraStatus.MAINTENANCE:
      return '#f59e0b'; // amber-500
    default:
      return '#6b7280'; // gray-500
  }
}

// Get border color class based on camera status
export function getCameraStatusBorderClass(status: CameraStatus): string {
  switch (status) {
    case CameraStatus.ONLINE:
      return 'border-green-500';
    case CameraStatus.RECORDING:
      return 'border-blue-500';
    case CameraStatus.OFFLINE:
      return 'border-red-500';
    case CameraStatus.MAINTENANCE:
      return 'border-amber-500';
    default:
      return 'border-gray-500';
  }
}

// Generate HTML for Leaflet divIcon
export function generateCameraMarkerHtml(camera: Camera, hasRecentDetection: boolean = false): string {
  const color = getCameraStatusColor(camera.status);
  const isOnline = camera.status === CameraStatus.ONLINE || camera.status === CameraStatus.RECORDING;
  
  const detectionIndicator = hasRecentDetection 
    ? `<div class="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse border border-white"></div>`
    : '';

  return `
    <div class="relative group cursor-pointer transition-transform hover:scale-110 hover:z-50">
      <div class="w-8 h-8 rounded-lg border-2 flex items-center justify-center bg-eagle-900/90 shadow-lg relative z-10" 
           style="border-color: ${color}; box-shadow: 0 0 10px ${color}40;">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" 
             stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          ${isOnline 
            ? '<path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/>'
            : '<path d="M10.66 6H14a2 2 0 0 1 2 2v2.34l1 1L22 8v8"/><path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2l10 10Z"/><line x1="2" x2="22" y1="2" y2="22"/>'
          }
        </svg>
      </div>
      ${detectionIndicator}
      <div class="absolute -bottom-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[6px]" 
           style="border-top-color: ${color}"></div>
    </div>
  `;
}

// Generate popup content for camera marker
export function generateCameraPopupHtml(camera: Camera): string {
  const color = getCameraStatusColor(camera.status);
  const statusLabel = camera.status.replace('_', ' ');
  const lastOnline = camera.lastOnline 
    ? new Date(camera.lastOnline).toLocaleString()
    : 'Never';

  return `
    <div style="min-width: 200px; font-family: 'JetBrains Mono', monospace;">
      <div style="background: #0f172a; border-bottom: 2px solid ${color}; padding: 8px; margin: -1px -1px 8px -1px; border-radius: 4px 4px 0 0;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong style="color: white; font-size: 13px;">${camera.name}</strong>
          <span style="font-size: 10px; background:${color}; color:white; padding: 2px 6px; border-radius: 2px;">${statusLabel}</span>
        </div>
      </div>
      <div style="padding: 0 4px;">
        ${camera.description ? `<div style="font-size: 11px; color: #94a3b8; margin-bottom: 8px;">${camera.description}</div>` : ''}
        <div style="font-size: 10px; color: #64748b; margin-bottom: 4px;">
          <strong>Coordinates:</strong> ${camera.coordinates.lat.toFixed(4)}, ${camera.coordinates.lng.toFixed(4)}
        </div>
        <div style="font-size: 10px; color: #64748b;">
          <strong>Last Online:</strong> ${lastOnline}
        </div>
      </div>
      <div style="margin-top: 10px;">
        <button class="camera-view-feed-btn" data-camera-id="${camera.id}" 
                style="width: 100%; background: #1e293b; color: #60a5fa; border: 1px solid #334155; padding: 6px; font-size: 10px; cursor: pointer; border-radius: 2px; font-weight: bold;">
          VIEW LIVE FEED
        </button>
      </div>
    </div>
  `;
}

// React component for use outside of Leaflet (e.g., in lists)
export const CameraMarker: React.FC<CameraMarkerProps> = ({ camera, onClick, hasRecentDetection }) => {
  const color = getCameraStatusColor(camera.status);
  const isOnline = camera.status === CameraStatus.ONLINE || camera.status === CameraStatus.RECORDING;

  return (
    <div 
      className="relative group cursor-pointer transition-transform hover:scale-110"
      onClick={onClick}
    >
      <div 
        className={`w-8 h-8 rounded-lg border-2 flex items-center justify-center bg-eagle-900/90 shadow-lg ${getCameraStatusBorderClass(camera.status)}`}
        style={{ boxShadow: `0 0 10px ${color}40` }}
      >
        {isOnline ? (
          <Video size={16} style={{ color }} />
        ) : (
          <VideoOff size={16} style={{ color }} />
        )}
      </div>
      {hasRecentDetection && (
        <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse border border-white" />
      )}
    </div>
  );
};

export default CameraMarker;
