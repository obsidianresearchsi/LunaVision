import React, { useState, useEffect, useRef } from 'react';
import { useDialogAccessibility } from './useDialogAccessibility';
import { Case, CaseStatus, CasePriority, SearchResult } from '../types';
import { caseService } from '../services/caseService';
import { LinkCasePreview } from './OperationsUI';
import {
  X,
  Link as LinkIcon,
  Loader2,
  AlertTriangle,
  Search,
  FileText,
  Plus,
  CheckCircle2,
  Briefcase,
  Database
} from 'lucide-react';

interface LinkSearchToCaseModalProps {
  auditLogId: string;
  searchResults: SearchResult[];
  probeImagePreview?: string;
  recordedResultCount?: number;
  currentOfficerId: string;
  onClose: () => void;
  onSuccess?: (caseId: string) => void;
}

export const LinkSearchToCaseModal: React.FC<LinkSearchToCaseModalProps> = ({
  auditLogId,
  searchResults,
  probeImagePreview,
  recordedResultCount,
  currentOfficerId,
  onClose,
  onSuccess
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogAccessibility(dialogRef, onClose);
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [linkSubjects, setLinkSubjects] = useState(true);
  
  // New case form state
  const [newCaseTitle, setNewCaseTitle] = useState('');
  const [newCaseDescription, setNewCaseDescription] = useState('');
  const [newCasePriority, setNewCasePriority] = useState<CasePriority>(CasePriority.MEDIUM);

  // Load existing cases
  useEffect(() => {
    const loadCases = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await caseService.getCases({ pageSize: 100 });
        const activeCases = result.cases.filter(c => c.status !== CaseStatus.CLOSED);
        setCases(activeCases);
      } catch (err: any) {
        setError(err.message || 'Failed to load cases');
      } finally {
        setLoading(false);
      }
    };
    loadCases();
  }, []);

  // Filter cases by search query
  const filteredCases = cases.filter(c =>
    c.caseNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );


  const linkSearchSubjects = async (caseId: string) => {
    const outcome = { linked: 0, duplicate: 0, failed: 0 };
    if (linkSubjects) for (const result of searchResults) {
      try {
        await caseService.linkSubject(caseId, {
          suspectFaceToken: result.suspect.faceToken,
          matchConfidence: result.confidence,
          matchType: result.matchType as 'EXACT' | 'RELATIVE'
        }, currentOfficerId);
        outcome.linked++;
      } catch (error: any) {
        if (error.code === 'DUPLICATE_LINK') outcome.duplicate++;
        else outcome.failed++;
      }
    }
    if (outcome.failed) setWarning(`${outcome.failed} subject association(s) could not be saved. The search session remains linked. Link the missing subjects individually from results.`);
    return outcome;
  };
  const outcomeSummary = (outcome: { linked: number; duplicate: number }) =>
    linkSubjects && searchResults.length ? ` ${outcome.linked} subject(s) added; ${outcome.duplicate} already linked.` : '';

  // Handle linking search to existing case
  const handleLinkToCase = async () => {
    if (!selectedCaseId) return;
    
    setLinking(true);
    setError(null);
    setSuccess(null);
    setWarning(null);
    
    try {
      // Link the search session
      await caseService.linkSearch(selectedCaseId, auditLogId, currentOfficerId);
      
      const outcome = await linkSearchSubjects(selectedCaseId);
      setSuccess(`Search session linked to case.${outcomeSummary(outcome)}`);
      onSuccess?.(selectedCaseId);
      
      if (!outcome.failed) setTimeout(() => onClose(), 1500);
    } catch (err: any) {
      if (err.code === 'DUPLICATE_LINK') {
        setError('This search is already linked to the selected case');
      } else {
        setError(err.message || 'Failed to link search to case');
      }
    } finally {
      setLinking(false);
    }
  };

  // Handle creating new case and linking search
  const handleCreateAndLink = async () => {
    if (!newCaseTitle.trim() || !newCaseDescription.trim()) {
      setError('Title and description are required');
      return;
    }
    
    setLinking(true);
    setError(null);
    setSuccess(null);
    setWarning(null);
    
    try {
      // Create new case
      const newCase = await caseService.createCase(
        {
          title: newCaseTitle.trim(),
          description: newCaseDescription.trim(),
          priority: newCasePriority,
          initialNotes: `Case created from search session with ${searchResults.length} result(s)`
        },
        currentOfficerId
      );
      
      // Link the search session
      await caseService.linkSearch(newCase.id, auditLogId, currentOfficerId);
      
      const outcome = await linkSearchSubjects(newCase.id);
      setSuccess(`Case ${newCase.caseNumber} created with search session linked.${outcomeSummary(outcome)}`);
      onSuccess?.(newCase.id);
      
      if (!outcome.failed) setTimeout(() => onClose(), 1500);
    } catch (err: any) {
      setError(err.message || 'Failed to create case');
    } finally {
      setLinking(false);
    }
  };

  const getStatusColor = (status: CaseStatus) => {
    switch (status) {
      case CaseStatus.OPEN: return 'bg-blue-900/50 text-blue-400 border-blue-800';
      case CaseStatus.IN_PROGRESS: return 'bg-yellow-900/50 text-yellow-400 border-yellow-800';
      case CaseStatus.UNDER_REVIEW: return 'bg-purple-900/50 text-purple-400 border-purple-800';
      default: return 'bg-slate-900/50 text-slate-400 border-slate-800';
    }
  };

  const getPriorityColor = (priority: CasePriority) => {
    switch (priority) {
      case CasePriority.CRITICAL: return 'bg-red-900/50 text-red-400 border-red-800';
      case CasePriority.HIGH: return 'bg-orange-900/50 text-orange-400 border-orange-800';
      case CasePriority.MEDIUM: return 'bg-yellow-900/50 text-yellow-400 border-yellow-800';
      case CasePriority.LOW: return 'bg-green-900/50 text-green-400 border-green-800';
      default: return 'bg-slate-900/50 text-slate-400 border-slate-800';
    }
  };


  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" 
      onClick={onClose}
    >
      <div 
        className="case-link-dialog bg-eagle-800 border border-eagle-700 rounded-xl shadow-2xl w-full mx-4 overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Link search to case"
      >
        {/* Header */}
        <div className="p-4 border-b border-eagle-700 flex justify-between items-center shrink-0">
          <h3 className="text-lg font-bold text-white flex items-center">
            <Database className="mr-2 text-blue-500" size={20} />
            Link Search to Case
          </h3>
          <button 
            onClick={onClose} 
            className="text-slate-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <LinkCasePreview title="SEARCH SESSION → CASE ASSOCIATION" source={auditLogId}
          destination={showCreateForm ? (newCaseTitle || 'New case') : cases.find(item => item.id === selectedCaseId)?.caseNumber}
          includes={linkSubjects && searchResults.length ? `Links the saved search session and ${searchResults.length} subject association(s).` : 'Links the saved search session. Subject associations are not added.'} />
        {/* Search Summary */}
        <div className="p-4 bg-eagle-900 border-b border-eagle-700 shrink-0">
          <div className="flex items-center space-x-3">
            {probeImagePreview && (
              <div className="w-12 h-12 rounded bg-black overflow-hidden border border-slate-700">
                <img 
                  src={probeImagePreview.startsWith('data:') ? probeImagePreview : `data:image/jpeg;base64,${probeImagePreview}`}
                  alt="Probe"
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-white font-medium">Search Session</p>
              <div className="flex items-center space-x-2 text-xs">
                <span className="text-slate-400">{recordedResultCount ?? searchResults.length} recorded result(s)</span>
                <span className="text-slate-600">•</span>
                <span className="text-slate-500 font-mono truncate">{auditLogId}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          {warning && <div role="alert" className="p-3 text-sm text-amber-200 border border-amber-700 bg-amber-900/30">{warning}</div>}
          {/* Error/Success Display */}
          {error && (
            <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 flex items-center space-x-2">
              <AlertTriangle size={16} className="text-red-400 shrink-0" />
              <span className="text-red-400 text-sm">{error}</span>
            </div>
          )}
          
          {success && (
            <div className="bg-green-900/30 border border-green-800 rounded-lg p-3 flex items-center space-x-2">
              <CheckCircle2 size={16} className="text-green-400 shrink-0" />
              <span className="text-green-400 text-sm">{success}</span>
            </div>
          )}

          {/* Option to link subjects */}
          {searchResults.length > 0 && (
            <label className="flex items-center space-x-3 p-3 bg-eagle-900 border border-eagle-700 rounded-lg cursor-pointer hover:border-eagle-600 transition-colors">
              <input
                type="checkbox"
                checked={linkSubjects}
                onChange={(e) => setLinkSubjects(e.target.checked)}
                className="w-4 h-4 rounded border-slate-600 bg-eagle-800 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <p className="text-white text-sm font-medium">Also link all {searchResults.length} subject(s)</p>
                <p className="text-slate-400 text-xs">Include matched suspects in the case</p>
              </div>
            </label>
          )}

          {/* Toggle between existing case and new case */}
          <div className="flex space-x-2">
            <button
              onClick={() => setShowCreateForm(false)}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors flex items-center justify-center space-x-2 ${
                !showCreateForm 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-eagle-900 text-slate-400 hover:text-white border border-eagle-700'
              }`}
            >
              <LinkIcon size={14} />
              <span>Existing Case</span>
            </button>
            <button
              onClick={() => setShowCreateForm(true)}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors flex items-center justify-center space-x-2 ${
                showCreateForm 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-eagle-900 text-slate-400 hover:text-white border border-eagle-700'
              }`}
            >
              <Plus size={14} />
              <span>New Case</span>
            </button>
          </div>

          {!showCreateForm ? (
            <>
              {/* Search Input */}
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search cases by number or title..."
                  className="w-full bg-eagle-900 border border-eagle-700 rounded-lg pl-10 pr-4 py-2 text-white placeholder-slate-500 focus:border-blue-500 outline-none text-sm"
                />
              </div>

              {/* Cases List */}
              <div className="max-h-48 overflow-y-auto space-y-2">
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 size={24} className="animate-spin text-blue-500" />
                  </div>
                ) : filteredCases.length === 0 ? (
                  <div className="text-center py-8">
                    <Briefcase size={32} className="mx-auto text-slate-500 mb-2" />
                    <p className="text-slate-400 text-sm">
                      {searchQuery ? 'No cases match your search' : 'No active cases available'}
                    </p>
                    <button
                      onClick={() => setShowCreateForm(true)}
                      className="mt-2 text-blue-400 hover:text-blue-300 text-sm"
                    >
                      Create a new case
                    </button>
                  </div>
                ) : (
                  filteredCases.map((caseItem) => (
                    <CaseCard
                      key={caseItem.id}
                      caseItem={caseItem}
                      isSelected={selectedCaseId === caseItem.id}
                      onSelect={() => setSelectedCaseId(caseItem.id)}
                      getStatusColor={getStatusColor}
                      getPriorityColor={getPriorityColor}
                    />
                  ))
                )}
              </div>
            </>
          ) : (
            /* New Case Form */
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Case Title *</label>
                <input
                  type="text"
                  value={newCaseTitle}
                  onChange={(e) => setNewCaseTitle(e.target.value)}
                  placeholder="Enter case title..."
                  className="w-full bg-eagle-900 border border-eagle-700 rounded-lg px-4 py-2 text-white placeholder-slate-500 focus:border-blue-500 outline-none text-sm"
                />
              </div>
              
              <div>
                <label className="block text-xs text-slate-400 mb-1">Description *</label>
                <textarea
                  value={newCaseDescription}
                  onChange={(e) => setNewCaseDescription(e.target.value)}
                  placeholder="Enter case description..."
                  rows={3}
                  className="w-full bg-eagle-900 border border-eagle-700 rounded-lg px-4 py-2 text-white placeholder-slate-500 focus:border-blue-500 outline-none text-sm resize-none"
                />
              </div>
              
              <div>
                <label className="block text-xs text-slate-400 mb-1">Priority</label>
                <select
                  value={newCasePriority}
                  onChange={(e) => setNewCasePriority(e.target.value as CasePriority)}
                  className="w-full bg-eagle-900 border border-eagle-700 rounded-lg px-4 py-2 text-white focus:border-blue-500 outline-none text-sm"
                >
                  <option value={CasePriority.LOW}>Low</option>
                  <option value={CasePriority.MEDIUM}>Medium</option>
                  <option value={CasePriority.HIGH}>High</option>
                  <option value={CasePriority.CRITICAL}>Critical</option>
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="case-link-destination">Destination: {showCreateForm ? (newCaseTitle || 'Enter new case details') : (cases.find(item => item.id === selectedCaseId)?.title || 'Choose an active case above')}</div>
        {/* Footer */}
        <div className="p-4 border-t border-eagle-700 flex justify-end space-x-3 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={showCreateForm ? handleCreateAndLink : handleLinkToCase}
            disabled={
              linking || 
              success !== null ||
              (!showCreateForm && !selectedCaseId) ||
              (showCreateForm && (!newCaseTitle.trim() || !newCaseDescription.trim()))
            }
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg flex items-center space-x-2 transition-colors"
          >
            {linking && <Loader2 size={16} className="animate-spin" />}
            <span>
              {linking 
                ? (showCreateForm ? 'Creating...' : 'Linking...') 
                : (showCreateForm ? 'Create & Link' : 'Link Search')
              }
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};


// Case Card Component
interface CaseCardProps {
  caseItem: Case;
  isSelected: boolean;
  onSelect: () => void;
  getStatusColor: (status: CaseStatus) => string;
  getPriorityColor: (priority: CasePriority) => string;
}

const CaseCard: React.FC<CaseCardProps> = ({
  caseItem,
  isSelected,
  onSelect,
  getStatusColor,
  getPriorityColor
}) => {
  return (
    <button
      onClick={onSelect}
      aria-pressed={isSelected}
      className={`w-full p-3 rounded-lg border transition-all text-left ${
        isSelected
          ? 'bg-blue-900/30 border-blue-600'
          : 'bg-eagle-900 border-eagle-700 hover:border-eagle-600'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2 mb-1">
            <FileText size={14} className="text-slate-500 shrink-0" />
            <span className="text-xs font-mono text-blue-400">{caseItem.caseNumber}</span>
          </div>
          <p className="text-white text-sm font-medium truncate">{caseItem.title}</p>
          <div className="flex items-center space-x-2 mt-2">
            <span className={`text-xs px-2 py-0.5 rounded border ${getStatusColor(caseItem.status)}`}>
              {caseItem.status.replace('_', ' ')}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded border ${getPriorityColor(caseItem.priority)}`}>
              {caseItem.priority}
            </span>
          </div>
        </div>
        {isSelected && (
          <CheckCircle2 size={20} className="text-blue-500 shrink-0 ml-2" />
        )}
      </div>
    </button>
  );
};

export default LinkSearchToCaseModal;
