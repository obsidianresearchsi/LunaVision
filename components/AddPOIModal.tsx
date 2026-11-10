/**
 * AddPOIModal Component
 * 
 * Modal for adding a new Person of Interest to the watchlist.
 * Includes form for face token, name, priority, case link, and notes.
 */

import React, { useState, useEffect } from 'react';
import { X, UserPlus, AlertTriangle, Loader2 } from 'lucide-react';
import { POIPriority, Case, AddPOIInput } from '../types';
import { caseService } from '../services/caseService';

interface AddPOIModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: AddPOIInput) => Promise<void>;
  initialFaceToken?: string;
  initialName?: string;
  initialImageUrl?: string;
}

export function AddPOIModal({
  isOpen,
  onClose,
  onSubmit,
  initialFaceToken = '',
  initialName = '',
  initialImageUrl = ''
}: AddPOIModalProps) {
  const [faceToken, setFaceToken] = useState(initialFaceToken);
  const [name, setName] = useState(initialName);
  const [imageUrl, setImageUrl] = useState(initialImageUrl);
  const [priority, setPriority] = useState<POIPriority>(POIPriority.MEDIUM);
  const [caseId, setCaseId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [cases, setCases] = useState<Case[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadCases();
      // Reset form with initial values
      setFaceToken(initialFaceToken);
      setName(initialName);
      setImageUrl(initialImageUrl);
      setPriority(POIPriority.MEDIUM);
      setCaseId('');
      setNotes('');
      setError(null);
    }
  }, [isOpen, initialFaceToken, initialName, initialImageUrl]);

  async function loadCases() {
    try {
      const result = await caseService.getCases({});
      setCases(result.cases);
    } catch (err) {
      console.error('Failed to load cases:', err);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!faceToken.trim()) {
      setError('Face token is required');
      return;
    }
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    setIsLoading(true);
    try {
      await onSubmit({
        faceToken: faceToken.trim(),
        name: name.trim(),
        imageUrl: imageUrl.trim() || undefined,
        priority,
        caseId: caseId || undefined,
        notes: notes.trim() || undefined
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to add POI');
    } finally {
      setIsLoading(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold">Add Person of Interest</h2>
          </div>
          <button
            onClick={onClose}
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

          {/* Face Token */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Face Token <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={faceToken}
              onChange={(e) => setFaceToken(e.target.value)}
              placeholder="Enter Face++ face token"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
              disabled={isLoading}
            />
            <p className="mt-1 text-xs text-gray-500">
              The unique face token from Face++ faceset
            </p>
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter person's name"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isLoading}
            />
          </div>

          {/* Image URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Image URL
            </label>
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://example.com/image.jpg"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isLoading}
            />
          </div>

          {/* Priority */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Priority
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as POIPriority)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isLoading}
            >
              <option value={POIPriority.CRITICAL}>🔴 Critical</option>
              <option value={POIPriority.HIGH}>🟠 High</option>
              <option value={POIPriority.MEDIUM}>🟡 Medium</option>
              <option value={POIPriority.LOW}>🟢 Low</option>
            </select>
          </div>

          {/* Link to Case */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Link to Case
            </label>
            <select
              value={caseId}
              onChange={(e) => setCaseId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isLoading}
            >
              <option value="">No case linked</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.caseNumber} - {c.title}
                </option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes about this person..."
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
                  Adding...
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  Add to Watchlist
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AddPOIModal;
