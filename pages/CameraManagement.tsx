/**
 * CameraManagement Page
 * 
 * Admin-only page for managing surveillance cameras.
 * Includes list view, add/edit/delete functionality.
 */

import React, { useState, useEffect } from 'react';
import { 
  Camera, Plus, Edit2, Trash2, RefreshCw, Search, 
  MapPin, Video, AlertTriangle, CheckCircle, XCircle,
  Loader2, Filter
} from 'lucide-react';
import { Camera as CameraType, CameraStatus } from '../types';
import { getCameras, deleteCamera, updateCameraStatus } from '../services/cameraService';
import { CameraManagementModal } from '../components/CameraManagementModal';

export function CameraManagementPage() {
  const [cameras, setCameras] = useState<CameraType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<CameraStatus | 'ALL'>('ALL');
  
  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCamera, setEditingCamera] = useState<CameraType | null>(null);
  
  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<CameraType | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    loadCameras();
  }, []);

  async function loadCameras() {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getCameras();
      setCameras(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load cameras');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDelete(camera: CameraType) {
    setIsDeleting(true);
    try {
      await deleteCamera(camera.id);
      setCameras(prev => prev.filter(c => c.id !== camera.id));
      setDeleteConfirm(null);
    } catch (err: any) {
      setError(err.message || 'Failed to delete camera');
    } finally {
      setIsDeleting(false);
    }
  }

  function handleEdit(camera: CameraType) {
    setEditingCamera(camera);
    setIsModalOpen(true);
  }

  function handleAddNew() {
    setEditingCamera(null);
    setIsModalOpen(true);
  }

  function handleModalClose() {
    setIsModalOpen(false);
    setEditingCamera(null);
  }

  function handleModalSave() {
    loadCameras();
  }

  // Filter cameras
  const filteredCameras = cameras.filter(camera => {
    const matchesSearch = camera.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          camera.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || camera.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusIcon = (status: CameraStatus) => {
    switch (status) {
      case CameraStatus.ONLINE:
      case CameraStatus.RECORDING:
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case CameraStatus.OFFLINE:
        return <XCircle className="w-4 h-4 text-red-500" />;
      case CameraStatus.MAINTENANCE:
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      default:
        return <XCircle className="w-4 h-4 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: CameraStatus) => {
    const colors: Record<CameraStatus, string> = {
      [CameraStatus.ONLINE]: 'bg-green-500/20 text-green-400 border-green-500/30',
      [CameraStatus.RECORDING]: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      [CameraStatus.OFFLINE]: 'bg-red-500/20 text-red-400 border-red-500/30',
      [CameraStatus.MAINTENANCE]: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    };
    return colors[status] || 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-600 rounded-lg">
            <Camera className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Device fleet</h1>
            <p className="text-sm text-slate-400">Manage surveillance cameras</p>
          </div>
        </div>
        <button
          onClick={handleAddNew}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add device
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search cameras..."
            className="w-full pl-10 pr-4 py-2 bg-eagle-800 border border-eagle-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as CameraStatus | 'ALL')}
            className="px-3 py-2 bg-eagle-800 border border-eagle-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
          >
            <option value="ALL">All Status</option>
            <option value={CameraStatus.ONLINE}>Online</option>
            <option value={CameraStatus.RECORDING}>Recording</option>
            <option value={CameraStatus.OFFLINE}>Offline</option>
            <option value={CameraStatus.MAINTENANCE}>Maintenance</option>
          </select>
        </div>
        <button
          onClick={loadCameras}
          disabled={isLoading}
          className="p-2 bg-eagle-800 border border-eagle-700 rounded-lg text-slate-400 hover:text-white hover:border-eagle-600 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400">
          <AlertTriangle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}

      {/* Camera List */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : filteredCameras.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <Video className="w-12 h-12 mb-3 opacity-50" />
            <p>No cameras found</p>
            {cameras.length === 0 && (
              <button
                onClick={handleAddNew}
                className="mt-3 text-blue-400 hover:text-blue-300"
              >
                Add your first camera
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredCameras.map(camera => (
              <div
                key={camera.id}
                className="bg-eagle-800 border border-eagle-700 rounded-lg p-4 hover:border-eagle-600 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-eagle-700 rounded-lg">
                      <Video className="w-6 h-6 text-blue-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-white">{camera.name}</h3>
                        <span className={`px-2 py-0.5 text-xs rounded-full border ${getStatusBadge(camera.status)}`}>
                          {camera.status}
                        </span>
                      </div>
                      {camera.description && (
                        <p className="text-sm text-slate-400 mb-2">{camera.description}</p>
                      )}
                      <div className="flex items-center gap-4 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {camera.coordinates.lat.toFixed(4)}, {camera.coordinates.lng.toFixed(4)}
                        </span>
                        <span className="font-mono truncate max-w-xs" title={camera.streamUrl}>
                          {camera.streamUrl}
                        </span>
                      </div>
                      {camera.lastOnline && (
                        <p className="text-xs text-slate-500 mt-1">
                          Last online: {new Date(camera.lastOnline).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEdit(camera)}
                      className="p-2 text-slate-400 hover:text-white hover:bg-eagle-700 rounded-lg transition-colors"
                      title="Edit camera"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(camera)}
                      className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      title="Delete camera"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stats Footer */}
      <div className="mt-4 pt-4 border-t border-eagle-800 flex items-center justify-between text-sm text-slate-400">
        <span>Total: {cameras.length} cameras</span>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <CheckCircle className="w-3 h-3 text-green-500" />
            {cameras.filter(c => c.status === CameraStatus.ONLINE || c.status === CameraStatus.RECORDING).length} online
          </span>
          <span className="flex items-center gap-1">
            <XCircle className="w-3 h-3 text-red-500" />
            {cameras.filter(c => c.status === CameraStatus.OFFLINE).length} offline
          </span>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <CameraManagementModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        onSave={handleModalSave}
        camera={editingCamera}
      />

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDeleteConfirm(null)} />
          <div className="relative bg-eagle-800 border border-eagle-700 rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-red-500/20 rounded-full">
                <AlertTriangle className="w-6 h-6 text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">Delete Camera</h3>
            </div>
            <p className="text-slate-300 mb-2">
              Are you sure you want to delete <strong>{deleteConfirm.name}</strong>?
            </p>
            <p className="text-sm text-slate-400 mb-6">
              This will also delete all associated detections and alerts. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-slate-300 hover:bg-eagle-700 rounded-lg transition-colors"
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CameraManagementPage;
