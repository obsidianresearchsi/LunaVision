import React, { useState, useEffect } from 'react';
import { User, UserRole } from '../types';
import { supabaseDb } from '../services/supabaseDb';
import {
  X,
  UserPlus,
  Loader2,
  AlertTriangle,
  Search,
  User as UserIcon,
  Shield
} from 'lucide-react';

interface AssignOfficerModalProps {
  caseId: string;
  caseNumber: string;
  currentAssigneeId?: string;
  onAssign: (officerId: string) => Promise<void>;
  onClose: () => void;
}

export const AssignOfficerModal: React.FC<AssignOfficerModalProps> = ({
  caseId,
  caseNumber,
  currentAssigneeId,
  onAssign,
  onClose
}) => {
  const [officers, setOfficers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOfficerId, setSelectedOfficerId] = useState<string | null>(null);

  // Load available officers
  useEffect(() => {
    const loadOfficers = async () => {
      setLoading(true);
      setError(null);
      try {
        const users = await supabaseDb.getUsers();
        // Filter to only show officers (not commanders for assignment)
        const availableOfficers = users.filter(u => u.role === UserRole.OFFICER);
        setOfficers(availableOfficers);
      } catch (err: any) {
        setError(err.message || 'Failed to load officers');
      } finally {
        setLoading(false);
      }
    };
    loadOfficers();
  }, []);

  // Filter officers by search query
  const filteredOfficers = officers.filter(officer =>
    officer.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    officer.id.toLowerCase().includes(searchQuery.toLowerCase())
  );


  // Handle assignment
  const handleAssign = async () => {
    if (!selectedOfficerId) return;
    
    setAssigning(true);
    setError(null);
    try {
      await onAssign(selectedOfficerId);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to assign officer');
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" 
      onClick={onClose}
    >
      <div 
        className="bg-eagle-800 border border-eagle-700 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-eagle-700 flex justify-between items-center">
          <h3 className="text-lg font-bold text-white flex items-center">
            <UserPlus className="mr-2 text-blue-500" size={20} />
            Assign Officer
          </h3>
          <button 
            onClick={onClose} 
            className="text-slate-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Case Info */}
          <div className="bg-eagle-900 border border-eagle-700 rounded-lg p-3">
            <p className="text-xs text-slate-500 mb-1">Assigning to case</p>
            <p className="text-sm font-mono text-blue-400">{caseNumber}</p>
          </div>

          {/* Error Display */}
          {error && (
            <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 flex items-center space-x-2">
              <AlertTriangle size={16} className="text-red-400 shrink-0" />
              <span className="text-red-400 text-sm">{error}</span>
            </div>
          )}

          {/* Search Input */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search officers..."
              className="w-full bg-eagle-900 border border-eagle-700 rounded-lg pl-10 pr-4 py-2 text-white placeholder-slate-500 focus:border-blue-500 outline-none text-sm"
            />
          </div>

          {/* Officers List */}
          <div className="max-h-64 overflow-y-auto space-y-2">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={24} className="animate-spin text-blue-500" />
              </div>
            ) : filteredOfficers.length === 0 ? (
              <div className="text-center py-8">
                <UserIcon size={32} className="mx-auto text-slate-500 mb-2" />
                <p className="text-slate-400 text-sm">
                  {searchQuery ? 'No officers match your search' : 'No officers available'}
                </p>
              </div>
            ) : (
              filteredOfficers.map((officer) => (
                <OfficerCard
                  key={officer.id}
                  officer={officer}
                  isSelected={selectedOfficerId === officer.id}
                  isCurrentAssignee={currentAssigneeId === officer.id}
                  onSelect={() => setSelectedOfficerId(officer.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-eagle-700 flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleAssign}
            disabled={!selectedOfficerId || assigning || selectedOfficerId === currentAssigneeId}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg flex items-center space-x-2 transition-colors"
          >
            {assigning && <Loader2 size={16} className="animate-spin" />}
            <span>{assigning ? 'Assigning...' : 'Assign Officer'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

// Officer Card Component
interface OfficerCardProps {
  officer: User;
  isSelected: boolean;
  isCurrentAssignee: boolean;
  onSelect: () => void;
}

const OfficerCard: React.FC<OfficerCardProps> = ({
  officer,
  isSelected,
  isCurrentAssignee,
  onSelect
}) => {
  return (
    <button
      onClick={onSelect}
      disabled={isCurrentAssignee}
      className={`w-full p-3 rounded-lg border transition-all text-left ${
        isSelected
          ? 'bg-blue-900/30 border-blue-600'
          : isCurrentAssignee
            ? 'bg-eagle-900/50 border-eagle-700 opacity-50 cursor-not-allowed'
            : 'bg-eagle-900 border-eagle-700 hover:border-eagle-600'
      }`}
    >
      <div className="flex items-center space-x-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
          isSelected ? 'bg-blue-600' : 'bg-eagle-700'
        }`}>
          <span className="text-white font-bold">
            {officer.username.charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2">
            <p className="text-white text-sm font-medium truncate">
              {officer.username}
            </p>
            {isCurrentAssignee && (
              <span className="text-xs bg-green-900/50 text-green-400 px-2 py-0.5 rounded border border-green-800">
                Current
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 truncate">{officer.id}</p>
        </div>
        <Shield size={16} className={`${
          officer.role === UserRole.CHIEF_COMMANDER ? 'text-yellow-500' : 'text-slate-500'
        }`} />
      </div>
    </button>
  );
};
