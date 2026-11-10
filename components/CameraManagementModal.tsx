/**
 * CameraManagementModal Component
 * 
 * Modal for adding/editing cameras. Admin only.
 * Includes form for camera name, stream URL, coordinates, and description.
 */

import React, { useState, useEffect } from 'react';
import { X, Camera, MapPin, Link2, Loader2, AlertTriangle, CheckCircle } from 'lucide-react';
import { Camera as CameraType, CreateCameraInput, UpdateCameraInput } from '../types';
import { createCamera, updateCamera, validateStreamUrl } from '../services/cameraService';

interface CameraManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  camera?: CameraType | null; // If provided, edit mode
}

export function CameraManagementModal({
  isOpen,
  onClose,
  onSave,
  camera
}: CameraManagementModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [streamUrl, setStreamUrl] = useState('');
  const [lat, setLat] = useState<number>(0);
  const [lng, setLng] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [urlValid, setUrlValid] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isEditMode = !!camera;

  useEffect(() => {
    if (isOpen) {
      if (camera) {
        setName(camera.name);
        setDescription(camera.description || '');
        setStreamUrl(camera.streamUrl);
        setLat(camera.coordinates.lat);
        setLng(camera.coordinates.lng);
      } else {
        setName('');
        setDescription('');
        setStreamUrl('');
        setLat(0);
        setLng(0);
      }
      setError(null);
      setUrlValid(null);
    }
  }, [isOpen, camera]);

  async function handleValidateUrl() {
    if (!streamUrl.trim()) {
      setError('Stream URL is required');
      return;
    }

    setIsValidating(true);
    setUrlValid(null);
    try {
      const valid = await validateStreamUrl(streamUrl);
      setUrlValid(valid);
      if (!valid) {
        setError('Stream URL is not accessible. It may still work for RTSP/RTMP streams.');
      } else {
        setError(null);
      }
    } catch (err) {
      setUrlValid(false);
      setError('Failed to validate URL');
    } finally {
      setIsValidating(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Camera name is required');
      return;
    }
    if (!streamUrl.trim()) {
      setError('Stream URL is required');
      return;
    }

    setIsLoading(true);
    try {
      if (isEditMode && camera) {
        const updates: UpdateCameraInput = {
          name: name.trim(),
          description: description.trim(),
          streamUrl: streamUrl.trim(),
          lat,
          lng
        };
        await updateCamera(camera.id, updates);
      } else {
        const input: CreateCameraInput = {
          name: name.trim(),
          description: description.trim(),
          streamUrl: streamUrl.trim(),
          lat,
          lng
        };
        await createCamera(input);
      }
      onSave();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save camera');
    } finally {
      setIsLoading(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="lunar-camera-form relative bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold">
              {isEditMode ? 'Edit camera' : 'Add a camera'}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close camera form"
            className="p-1 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md flex items-center gap-2 text-red-700">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {/* Camera Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Camera Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Main Entrance Camera"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isLoading}
            />
          </div>

          {/* Stream URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Stream URL <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={streamUrl}
                onChange={(e) => {
                  setStreamUrl(e.target.value);
                  setUrlValid(null);
                }}
                placeholder="rtsp://192.168.1.100:554/live or https://..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={handleValidateUrl}
                disabled={isLoading || isValidating || !streamUrl.trim()}
                className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors disabled:opacity-50 flex items-center gap-1"
              >
                {isValidating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : urlValid === true ? (
                  <CheckCircle className="w-4 h-4 text-green-600" />
                ) : urlValid === false ? (
                  <AlertTriangle className="w-4 h-4 text-yellow-600" />
                ) : (
                  <Link2 className="w-4 h-4" />
                )}
                Test
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Supports HTTP, HTTPS, RTSP, and RTMP protocols
            </p>
          </div>

          {/* Coordinates */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <MapPin className="w-4 h-4 inline mr-1" />
              Location Coordinates
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Latitude</label>
                <input
                  type="number"
                  step="any"
                  value={lat}
                  onChange={(e) => setLat(parseFloat(e.target.value) || 0)}
                  placeholder="e.g., 40.7128"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={isLoading}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Longitude</label>
                <input
                  type="number"
                  step="any"
                  value={lng}
                  onChange={(e) => setLng(parseFloat(e.target.value) || 0)}
                  placeholder="e.g., -74.0060"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={isLoading}
                />
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description of camera location or purpose..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              disabled={isLoading}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Camera className="w-4 h-4" />
                  {isEditMode ? 'Update Camera' : 'Add Camera'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CameraManagementModal;
