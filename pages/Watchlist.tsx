/**
 * Watchlist Page
 * 
 * Displays all Persons of Interest with filtering, search, and management capabilities.
 * Includes detection history view for each POI.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Plus,
  Search,
  Filter,
  RefreshCw,
  AlertTriangle,
  Eye,
  X,
  Clock,
  Camera
} from 'lucide-react';
import {
  WatchlistPOI,
  POIPriority,
  Detection,
  AddPOIInput,
  Camera as CameraType
} from '../types';
import {
  getPOIs,
  addPOI,
  removePOI,
  updatePOI,
  getDetectionCount,
  getLastDetection,
  getDetectionHistory
} from '../services/watchlistService';
import { getCameras } from '../services/cameraService';
import { POICard } from '../components/POICard';
import { AddPOIModal } from '../components/AddPOIModal';
import { OperationsHeader, OperationsMetrics } from '../components/OperationsUI';

// POI with additional stats
interface POIWithStats extends WatchlistPOI {
  detectionCount: number;
  lastDetection: Detection | null;
}

export function WatchlistPage({ currentOfficerId, onNavigateToCase }: { currentOfficerId: string; onNavigateToCase?: (caseId: string) => void }) {
  const [pois, setPois] = useState<POIWithStats[]>([]);
  const [cameras, setCameras] = useState<CameraType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<POIPriority | 'ALL'>('ALL');
  const [showInactive, setShowInactive] = useState(false);

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedPOI, setSelectedPOI] = useState<WatchlistPOI | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [detectionHistory, setDetectionHistory] = useState<Detection[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Confirmation dialog
  const [poiToRemove, setPoiToRemove] = useState<WatchlistPOI | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [poisData, camerasData] = await Promise.all([
        getPOIs(!showInactive),
        getCameras()
      ]);

      // Load stats for each POI
      const poisWithStats = await Promise.all(
        poisData.map(async (poi) => {
          const [detectionCount, lastDetection] = await Promise.all([
            getDetectionCount(poi.id),
            getLastDetection(poi.id)
          ]);
          return { ...poi, detectionCount, lastDetection };
        })
      );

      setPois(poisWithStats);
      setCameras(camerasData);
    } catch (err: any) {
      setError(err.message || 'Failed to load watchlist');
    } finally {
      setIsLoading(false);
    }
  }, [showInactive]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Filter POIs
  const filteredPOIs = pois.filter((poi) => {
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (
        !poi.name.toLowerCase().includes(query) &&
        !poi.faceToken.toLowerCase().includes(query) &&
        !(poi.notes?.toLowerCase().includes(query))
      ) {
        return false;
      }
    }

    // Priority filter
    if (priorityFilter !== 'ALL' && poi.priority !== priorityFilter) {
      return false;
    }

    return true;
  });

  // Group by priority for display
  const groupedPOIs = {
    [POIPriority.CRITICAL]: filteredPOIs.filter((p) => p.priority === POIPriority.CRITICAL),
    [POIPriority.HIGH]: filteredPOIs.filter((p) => p.priority === POIPriority.HIGH),
    [POIPriority.MEDIUM]: filteredPOIs.filter((p) => p.priority === POIPriority.MEDIUM),
    [POIPriority.LOW]: filteredPOIs.filter((p) => p.priority === POIPriority.LOW)
  };

  async function handleAddPOI(input: AddPOIInput) {
    await addPOI(input, currentOfficerId);
    await loadData();
  }

  async function handleRemovePOI(poi: WatchlistPOI) {
    try {
      await removePOI(poi.id);
      setPoiToRemove(null);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to remove POI');
    }
  }

  async function handleViewHistory(poi: WatchlistPOI) {
    setSelectedPOI(poi);
    setIsHistoryOpen(true);
    setIsLoadingHistory(true);
    try {
      const history = await getDetectionHistory(poi.id, { pageSize: 50 });
      setDetectionHistory(history);
    } catch (err: any) {
      console.error('Failed to load detection history:', err);
    } finally {
      setIsLoadingHistory(false);
    }
  }

  function getCameraName(cameraId: string): string {
    const camera = cameras.find((c) => c.id === cameraId);
    return camera?.name || 'Unknown Camera';
  }

  return (
    <div className="ops-page" data-accent="red">
      {/* Header */}
      <OperationsHeader code="SUBJECT INTELLIGENCE / PRIORITY REGISTER" title="Watchlist"
        description="Persons of interest, recorded detections, and investigation context."
        icon={<Users />} actions={
        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add POI
          </button>
        </div>
      } />
      <OperationsMetrics items={[
        { label: 'Active subjects', value: isLoading ? '—' : pois.filter(p => p.isActive).length, detail: 'In loaded watchlist', tone: 'red' },
        { label: 'Critical priority', value: isLoading ? '—' : pois.filter(p => p.priority === POIPriority.CRITICAL).length, tone: 'amber' },
        { label: 'Case associations', value: isLoading ? '—' : pois.filter(p => p.caseId).length, detail: 'Subjects linked to a case', tone: 'violet' },
        { label: 'Recorded detections', value: isLoading ? '—' : pois.reduce((sum, p) => sum + p.detectionCount, 0), tone: 'green' }
      ]} />

      {/* Filters */}
      <div className="ops-toolbar rounded-lg">
        <div className="flex flex-wrap items-center gap-4">
          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, token, or notes..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Priority Filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as POIPriority | 'ALL')}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All Priorities</option>
              <option value={POIPriority.CRITICAL}>🔴 Critical</option>
              <option value={POIPriority.HIGH}>🟠 High</option>
              <option value={POIPriority.MEDIUM}>🟡 Medium</option>
              <option value={POIPriority.LOW}>🟢 Low</option>
            </select>
          </div>

          {/* Show Inactive Toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
            />
            <span className="text-sm text-gray-600">Show inactive</span>
          </label>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md flex items-center gap-2 text-red-700">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
        </div>
      )}

      {/* Empty State */}
      {!isLoading && filteredPOIs.length === 0 && (
        <div className="text-center py-12">
          <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No persons of interest</h3>
          <p className="text-gray-500 mb-4">
            {searchQuery || priorityFilter !== 'ALL'
              ? 'No POIs match your filters'
              : 'Add your first person of interest to start monitoring'}
          </p>
          {!searchQuery && priorityFilter === 'ALL' && (
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add POI
            </button>
          )}
        </div>
      )}

      {/* POI Grid by Priority */}
      {!isLoading && filteredPOIs.length > 0 && (
        <div className="space-y-8">
          {Object.entries(groupedPOIs).map(([priority, poisInGroup]) => {
            if (poisInGroup.length === 0) return null;
            return (
              <div key={priority}>
                <h2 className="watchlist-group-heading text-gray-900 mb-4">
                  <span className="watchlist-priority-dot" data-priority={priority} aria-hidden="true" />
                  {priority} Priority
                  <span className="text-sm font-normal text-gray-500">
                    ({poisInGroup.length})
                  </span>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {poisInGroup.map((poi) => (
                    <POICard
                      key={poi.id}
                      poi={poi}
                      detectionCount={poi.detectionCount}
                      lastDetection={poi.lastDetection}
                      onViewHistory={handleViewHistory}
                      onRemove={(p) => setPoiToRemove(p)}
                      onOpenCase={onNavigateToCase}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add POI Modal */}
      <AddPOIModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSubmit={handleAddPOI}
      />

      {/* Remove Confirmation Dialog */}
      {poiToRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setPoiToRemove(null)} />
          <div className="relative bg-white rounded-lg shadow-xl p-6 max-w-sm mx-4">
            <h3 className="text-lg font-semibold mb-2">Remove from Watchlist?</h3>
            <p className="text-gray-600 mb-4">
              Are you sure you want to remove <strong>{poiToRemove.name}</strong> from the
              watchlist? This will stop monitoring for this person.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setPoiToRemove(null)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRemovePOI(poiToRemove)}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detection History Modal */}
      {isHistoryOpen && selectedPOI && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => {
              setIsHistoryOpen(false);
              setSelectedPOI(null);
            }}
          />
          <div className="relative bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b">
              <div className="flex items-center gap-3">
                <Eye className="w-5 h-5 text-blue-600" />
                <div>
                  <h2 className="text-lg font-semibold">Detection History</h2>
                  <p className="text-sm text-gray-500">{selectedPOI.name}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsHistoryOpen(false);
                  setSelectedPOI(null);
                }}
                className="p-1 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {isLoadingHistory && (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-6 h-6 text-blue-600 animate-spin" />
                </div>
              )}

              {!isLoadingHistory && detectionHistory.length === 0 && (
                <div className="text-center py-8">
                  <Eye className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500">No detections recorded yet</p>
                </div>
              )}

              {!isLoadingHistory && detectionHistory.length > 0 && (
                <div className="space-y-3">
                  {detectionHistory.map((detection) => (
                    <div
                      key={detection.id}
                      className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg"
                    >
                      {/* Snapshot */}
                      {detection.snapshotUrl ? (
                        <img
                          src={detection.snapshotUrl}
                          alt="Detection snapshot"
                          className="w-16 h-16 rounded object-cover"
                        />
                      ) : (
                        <div className="w-16 h-16 rounded bg-gray-200 flex items-center justify-center">
                          <Camera className="w-6 h-6 text-gray-400" />
                        </div>
                      )}

                      {/* Details */}
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Camera className="w-4 h-4 text-gray-400" />
                          <span className="font-medium">
                            {getCameraName(detection.cameraId)}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-gray-600">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(detection.detectedAt).toLocaleString()}
                          </span>
                          <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">
                            {(detection.confidence * 100).toFixed(1)}% confidence
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default WatchlistPage;
