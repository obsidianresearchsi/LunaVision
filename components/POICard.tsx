/**
 * POICard Component
 * 
 * Displays a Person of Interest card with image, name, priority badge,
 * detection count, and last seen information.
 */

import React from 'react';
import { User, AlertTriangle, Clock, Eye, Trash2, Edit, Link } from 'lucide-react';
import { WatchlistPOI, POIPriority, Detection } from '../types';

interface POICardProps {
  poi: WatchlistPOI;
  detectionCount: number;
  lastDetection: Detection | null;
  onEdit?: (poi: WatchlistPOI) => void;
  onRemove?: (poi: WatchlistPOI) => void;
  onViewHistory?: (poi: WatchlistPOI) => void;
  onLinkToCase?: (poi: WatchlistPOI) => void;
  onOpenCase?: (caseId: string) => void;
}

const priorityColors: Record<POIPriority, { bg: string; text: string; border: string }> = {
  [POIPriority.CRITICAL]: { bg: 'bg-red-900/30', text: 'text-red-300', border: 'border-red-500' },
  [POIPriority.HIGH]: { bg: 'bg-orange-900/30', text: 'text-orange-300', border: 'border-orange-500' },
  [POIPriority.MEDIUM]: { bg: 'bg-purple-900/30', text: 'text-purple-300', border: 'border-purple-500' },
  [POIPriority.LOW]: { bg: 'bg-emerald-900/30', text: 'text-emerald-300', border: 'border-emerald-500' }
};

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function POICard({
  poi,
  detectionCount,
  lastDetection,
  onEdit,
  onRemove,
  onViewHistory,
  onLinkToCase,
  onOpenCase
}: POICardProps) {
  const colors = priorityColors[poi.priority];
  const isInactive = !poi.isActive;

  return (
    <div
      data-priority={poi.priority}
      className={`poi-dossier rounded-lg shadow-md overflow-hidden ${colors.border} ${
        isInactive ? 'opacity-60' : ''
      }`}
    >
      {/* Header with image and basic info */}
      <div className="p-4">
        <div className="flex items-start gap-4">
          {/* POI Image */}
          <div className="flex-shrink-0">
            {poi.imageUrl ? (
              <img
                src={poi.imageUrl}
                alt={poi.name}
                className="w-20 h-20 rounded-lg object-cover border-2 border-gray-200"
              />
            ) : (
              <div className="w-20 h-20 rounded-lg bg-gray-200 flex items-center justify-center border-2 border-gray-300">
                <User className="w-10 h-10 text-gray-400" />
              </div>
            )}
          </div>

          {/* POI Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-semibold text-gray-900 truncate">{poi.name}</h3>
              {isInactive && (
                <span className="px-2 py-0.5 text-xs bg-gray-200 text-gray-600 rounded">
                  Inactive
                </span>
              )}
            </div>

            {/* Priority Badge */}
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors.bg} ${colors.text}`}
            >
              <AlertTriangle className="w-3 h-3 mr-1" />
              {poi.priority}
            </span>

            {/* Face Token (truncated) */}
            <p className="poi-dossier-id text-xs text-gray-500 mt-1 font-mono truncate" title={poi.faceToken}>
              ID: {poi.faceToken.substring(0, 16)}...
            </p>
          </div>
        </div>

        {/* Notes */}
        {poi.notes && (
          <p className="mt-3 text-sm text-gray-600 line-clamp-2">{poi.notes}</p>
        )}

        {/* Stats */}
        <div className="mt-4 flex items-center gap-4 text-sm text-gray-600">
          <div className="flex items-center gap-1">
            <Eye className="w-4 h-4" />
            <span>{detectionCount} detections</span>
          </div>
          {lastDetection && (
            <div className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              <span>Last seen {formatTimeAgo(lastDetection.detectedAt)}</span>
            </div>
          )}
        </div>

        {/* Case Link */}
        {poi.caseId && (
          <div className="mt-2 flex items-center gap-1 text-sm text-blue-600">
            <Link className="w-4 h-4" />
            {onOpenCase ? <button className="truncate text-left hover:underline" title={poi.caseId} onClick={() => onOpenCase(poi.caseId!)}>View case / {poi.caseId}</button> : <span className="truncate" title={poi.caseId}>Case / {poi.caseId}</span>}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="poi-dossier-actions px-4 py-3 bg-gray-50 border-t border-gray-100 flex gap-2">
        {onViewHistory && (
          <button
            onClick={() => onViewHistory(poi)}
            className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200 rounded-md transition-colors flex items-center gap-1"
          >
            <Eye className="w-4 h-4" />
            History
          </button>
        )}
        {onLinkToCase && !poi.caseId && (
          <button
            onClick={() => onLinkToCase(poi)}
            className="px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-100 rounded-md transition-colors flex items-center gap-1"
          >
            <Link className="w-4 h-4" />
            Link Case
          </button>
        )}
        {onEdit && (
          <button
            onClick={() => onEdit(poi)}
            className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200 rounded-md transition-colors flex items-center gap-1"
          >
            <Edit className="w-4 h-4" />
            Edit
          </button>
        )}
        {onRemove && poi.isActive && (
          <button
            onClick={() => onRemove(poi)}
            className="px-3 py-1.5 text-sm text-red-700 hover:bg-red-100 rounded-md transition-colors flex items-center gap-1"
          >
            <Trash2 className="w-4 h-4" />
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

export default POICard;
