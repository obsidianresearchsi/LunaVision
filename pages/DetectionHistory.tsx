/**
 * Detection History Page
 * 
 * Displays chronological list of all detections with filtering capabilities.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Eye,
  Filter,
  RefreshCw,
  AlertTriangle,
  Camera,
  Clock,
  User,
  Download,
  Calendar
} from 'lucide-react';
import {
  Detection,
  WatchlistPOI,
  Camera as CameraType,
  DetectionFilters
} from '../types';
import { getDetections } from '../services/detectionService';
import { getPOIs } from '../services/watchlistService';
import { getCameras } from '../services/cameraService';

export function DetectionHistoryPage() {
  const [detections, setDetections] = useState<Detection[]>([]);
  const [pois, setPois] = useState<WatchlistPOI[]>([]);
  const [cameras, setCameras] = useState<CameraType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [poiFilter, setPoiFilter] = useState<string>('');
  const [cameraFilter, setCameraFilter] = useState<string>('');
  const [minConfidence, setMinConfidence] = useState<number>(0);
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  // Pagination
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const pageSize = 20;

  const loadData = useCallback(async (reset = false) => {
    if (reset) {
      setPage(1);
      setDetections([]);
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const [poisData, camerasData] = await Promise.all([
        getPOIs(false),
        getCameras()
      ]);
      setPois(poisData);
      setCameras(camerasData);

      const filters: DetectionFilters = {
        page: reset ? 1 : page,
        pageSize
      };
      if (poiFilter) filters.poiId = poiFilter;
      if (cameraFilter) filters.cameraId = cameraFilter;
      if (minConfidence > 0) filters.minConfidence = minConfidence / 100;
      if (dateFrom) filters.dateFrom = dateFrom;
      if (dateTo) filters.dateTo = dateTo;

      const detectionsData = await getDetections(filters);
      
      if (reset) {
        setDetections(detectionsData);
      } else {
        setDetections(prev => [...prev, ...detectionsData]);
      }
      
      setHasMore(detectionsData.length === pageSize);
    } catch (err: any) {
      setError(err.message || 'Failed to load detections');
    } finally {
      setIsLoading(false);
    }
  }, [poiFilter, cameraFilter, minConfidence, dateFrom, dateTo, page]);

  useEffect(() => {
    loadData(true);
  }, [poiFilter, cameraFilter, minConfidence, dateFrom, dateTo]);

  function getPOIName(poiId: string): string {
    const poi = pois.find(p => p.id === poiId);
    return poi?.name || 'Unknown';
  }

  function getPOIImage(poiId: string): string | undefined {
    const poi = pois.find(p => p.id === poiId);
    return poi?.imageUrl;
  }

  function getCameraName(cameraId: string): string {
    const camera = cameras.find(c => c.id === cameraId);
    return camera?.name || 'Unknown Camera';
  }

  function handleLoadMore() {
    setPage(prev => prev + 1);
    loadData(false);
  }

  function handleExport() {
    const csvContent = [
      ['Timestamp', 'POI Name', 'Camera', 'Confidence'].join(','),
      ...detections.map(d => [
        new Date(d.detectedAt).toISOString(),
        getPOIName(d.poiId),
        getCameraName(d.cameraId),
        (d.confidence * 100).toFixed(1) + '%'
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `detections_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="lunar-page-heading lunar-investigation-heading mb-6">
        <div className="flex items-center gap-3">
          <Eye className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Detection History</h1>
            <p className="text-sm text-gray-500">
              {detections.length} detection{detections.length !== 1 ? 's' : ''} found
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button
            onClick={() => loadData(true)}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          {/* POI Filter */}
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-gray-400" />
            <select
              value={poiFilter}
              onChange={(e) => setPoiFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All POIs</option>
              {pois.map(poi => (
                <option key={poi.id} value={poi.id}>{poi.name}</option>
              ))}
            </select>
          </div>

          {/* Camera Filter */}
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-gray-400" />
            <select
              value={cameraFilter}
              onChange={(e) => setCameraFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Cameras</option>
              {cameras.map(camera => (
                <option key={camera.id} value={camera.id}>{camera.name}</option>
              ))}
            </select>
          </div>

          {/* Confidence Filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <input
              type="number"
              min="0"
              max="100"
              value={minConfidence}
              onChange={(e) => setMinConfidence(Number(e.target.value))}
              placeholder="Min %"
              className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-500">% min</span>
          </div>

          {/* Date Range */}
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-400" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-gray-400">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
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
      {isLoading && detections.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
        </div>
      )}

      {/* Empty State */}
      {!isLoading && detections.length === 0 && (
        <div className="text-center py-12">
          <Eye className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No detections found</h3>
          <p className="text-gray-500">
            {poiFilter || cameraFilter || minConfidence > 0 || dateFrom || dateTo
              ? 'Try adjusting your filters'
              : 'Detections will appear here when POIs are spotted'}
          </p>
        </div>
      )}

      {/* Detection List */}
      {detections.length > 0 && (
        <div className="space-y-4">
          {detections.map((detection) => (
            <div
              key={detection.id}
              className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-4"
            >
              {/* POI Image */}
              <div className="flex-shrink-0">
                {getPOIImage(detection.poiId) ? (
                  <img
                    src={getPOIImage(detection.poiId)}
                    alt={getPOIName(detection.poiId)}
                    className="w-16 h-16 rounded-lg object-cover border-2 border-gray-200"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-gray-200 flex items-center justify-center">
                    <User className="w-8 h-8 text-gray-400" />
                  </div>
                )}
              </div>

              {/* Detection Snapshot */}
              {detection.snapshotUrl && (
                <div className="flex-shrink-0">
                  <img
                    src={detection.snapshotUrl}
                    alt="Detection snapshot"
                    className="w-16 h-16 rounded-lg object-cover border border-gray-200"
                  />
                </div>
              )}

              {/* Details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-semibold text-gray-900">
                    {getPOIName(detection.poiId)}
                  </h4>
                  <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">
                    {(detection.confidence * 100).toFixed(1)}% match
                  </span>
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-600">
                  <span className="flex items-center gap-1">
                    <Camera className="w-4 h-4" />
                    {getCameraName(detection.cameraId)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    {new Date(detection.detectedAt).toLocaleString()}
                  </span>
                </div>
              </div>


            </div>
          ))}

          {/* Load More */}
          {hasMore && (
            <div className="text-center pt-4">
              <button
                onClick={handleLoadMore}
                disabled={isLoading}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {isLoading ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default DetectionHistoryPage;
