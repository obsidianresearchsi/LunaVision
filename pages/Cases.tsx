import React, { useState, useEffect, useCallback } from 'react';
import { 
  Case, CaseStatus, CasePriority, CaseFilters, User, CreateCaseInput,
  PaginatedCases
} from '../types';
import { caseService } from '../services/caseService';
import { OperationsHeader, OperationsMetrics } from '../components/OperationsUI';
import { 
  Briefcase, Search, Filter, Plus, ChevronLeft, ChevronRight,
  AlertTriangle, Clock, CheckCircle, FileText, User as UserIcon,
  Calendar, X, Loader2
} from 'lucide-react';

interface CasesPageProps {
  user: User;
  onNavigateToCase: (caseId: string) => void;
}

// Status badge colors
const statusColors: Record<CaseStatus, { bg: string; text: string; border: string }> = {
  [CaseStatus.OPEN]: { bg: 'bg-blue-900/30', text: 'text-blue-400', border: 'border-blue-800' },
  [CaseStatus.IN_PROGRESS]: { bg: 'bg-yellow-900/30', text: 'text-yellow-400', border: 'border-yellow-800' },
  [CaseStatus.UNDER_REVIEW]: { bg: 'bg-purple-900/30', text: 'text-purple-400', border: 'border-purple-800' },
  [CaseStatus.CLOSED]: { bg: 'bg-slate-900/30', text: 'text-slate-400', border: 'border-slate-700' }
};

// Priority badge colors
const priorityColors: Record<CasePriority, { bg: string; text: string; border: string }> = {
  [CasePriority.LOW]: { bg: 'bg-slate-900/30', text: 'text-slate-400', border: 'border-slate-700' },
  [CasePriority.MEDIUM]: { bg: 'bg-blue-900/30', text: 'text-blue-400', border: 'border-blue-800' },
  [CasePriority.HIGH]: { bg: 'bg-orange-900/30', text: 'text-orange-400', border: 'border-orange-800' },
  [CasePriority.CRITICAL]: { bg: 'bg-red-900/30', text: 'text-red-400', border: 'border-red-800' }
};

// Status icons
const statusIcons: Record<CaseStatus, React.ReactNode> = {
  [CaseStatus.OPEN]: <Clock size={12} />,
  [CaseStatus.IN_PROGRESS]: <Loader2 size={12} className="animate-spin" />,
  [CaseStatus.UNDER_REVIEW]: <FileText size={12} />,
  [CaseStatus.CLOSED]: <CheckCircle size={12} />
};

export const CasesPage: React.FC<CasesPageProps> = ({ user, onNavigateToCase }) => {
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCases, setTotalCases] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Filter state
  const [filters, setFilters] = useState<CaseFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<CaseStatus | ''>('');
  const [priorityFilter, setPriorityFilter] = useState<CasePriority | ''>('');
  const [dateFromFilter, setDateFromFilter] = useState('');
  const [dateToFilter, setDateToFilter] = useState('');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // New case modal state
  const [showNewCaseModal, setShowNewCaseModal] = useState(false);

  // Load cases
  const loadCases = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const appliedFilters: CaseFilters = {
        page: currentPage,
        pageSize,
        ...filters
      };

      if (statusFilter) appliedFilters.status = statusFilter;
      if (priorityFilter) appliedFilters.priority = priorityFilter;
      if (dateFromFilter) appliedFilters.dateFrom = dateFromFilter;
      if (dateToFilter) appliedFilters.dateTo = dateToFilter;

      const result: PaginatedCases = await caseService.getCases(appliedFilters);
      setCases(result.cases);
      setTotalCases(result.total);
    } catch (err: any) {
      setError(err.message || 'Failed to load cases');
    } finally {
      setLoading(false);
    }
  }, [currentPage, filters, statusFilter, priorityFilter, dateFromFilter, dateToFilter]);

  // Search cases
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      loadCases();
      return;
    }

    setIsSearching(true);
    setError(null);
    try {
      const results = await caseService.searchCases(searchQuery);
      setCases(results);
      setTotalCases(results.length);
    } catch (err: any) {
      setError(err.message || 'Search failed');
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, loadCases]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      loadCases();
    }
  }, [loadCases, searchQuery]);

  // Apply filters
  const applyFilters = () => {
    setCurrentPage(1);
    setShowFilters(false);
    loadCases();
  };

  // Clear filters
  const clearFilters = () => {
    setStatusFilter('');
    setPriorityFilter('');
    setDateFromFilter('');
    setDateToFilter('');
    setFilters({});
    setCurrentPage(1);
    setShowFilters(false);
  };

  // Handle case creation
  const handleCaseCreated = (newCase: Case) => {
    setShowNewCaseModal(false);
    loadCases();
  };

  const totalPages = Math.ceil(totalCases / pageSize);

  return (
    <div className="ops-page space-y-6" data-accent="violet">
      {/* Header */}
      <OperationsHeader code="INVESTIGATIONS / CASE REGISTER" title="Case Management"
        description="Investigation files, assigned officers, and evidence associations."
        icon={<Briefcase />} actions={
        <button
          onClick={() => setShowNewCaseModal(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg flex items-center space-x-2 font-medium transition-colors"
        >
          <Plus size={18} />
          <span>New Case</span>
        </button>
      } />
      <OperationsMetrics items={[
        { label: 'Matching cases', value: loading ? '—' : totalCases, detail: 'Across current query', tone: 'violet' },
        { label: 'In progress', value: loading ? '—' : cases.filter(c => c.status === CaseStatus.IN_PROGRESS).length, detail: 'In loaded results', tone: 'amber' },
        { label: 'Critical priority', value: loading ? '—' : cases.filter(c => c.priority === CasePriority.CRITICAL).length, detail: 'In loaded results', tone: 'red' },
        { label: 'Awaiting assignment', value: loading ? '—' : cases.filter(c => !c.assignedOfficerId).length, detail: 'In loaded results' }
      ]} />

      {/* Search and Filter Bar */}
      <div className="ops-toolbar flex items-center">
        <div className="flex-1 flex items-center bg-eagle-800 border border-eagle-700 rounded-lg px-4 py-2">
          <Search size={18} className="text-slate-400 mr-3" />
          <input
            type="text"
            placeholder="Search by case number, title, or subject name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="flex-1 bg-transparent border-none outline-none text-white placeholder-slate-500"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                loadCases();
              }}
              className="text-slate-400 hover:text-white ml-2"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <button
          onClick={handleSearch}
          disabled={isSearching}
          className="px-4 py-2 bg-eagle-700 hover:bg-eagle-600 text-white rounded-lg flex items-center space-x-2 transition-colors"
        >
          {isSearching ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
          <span>Search</span>
        </button>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`px-4 py-2 rounded-lg flex items-center space-x-2 transition-colors ${
            showFilters || statusFilter || priorityFilter || dateFromFilter || dateToFilter
              ? 'bg-blue-600 text-white'
              : 'bg-eagle-700 hover:bg-eagle-600 text-white'
          }`}
        >
          <Filter size={18} />
          <span>Filters</span>
        </button>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <FilterPanel
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          priorityFilter={priorityFilter}
          setPriorityFilter={setPriorityFilter}
          dateFromFilter={dateFromFilter}
          setDateFromFilter={setDateFromFilter}
          dateToFilter={dateToFilter}
          setDateToFilter={setDateToFilter}
          onApply={applyFilters}
          onClear={clearFilters}
        />
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg p-4 flex items-center space-x-3">
          <AlertTriangle className="text-red-400" size={20} />
          <span className="text-red-400">{error}</span>
        </div>
      )}

      {/* Cases List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={32} className="animate-spin text-blue-500" />
        </div>
      ) : cases.length === 0 ? (
        <div className="bg-eagle-800 border border-eagle-700 rounded-lg p-12 text-center">
          <Briefcase size={48} className="mx-auto text-slate-500 mb-4" />
          <h3 className="text-lg font-medium text-white mb-2">No cases found</h3>
          <p className="text-slate-400 mb-4">
            {searchQuery ? 'Try adjusting your search terms' : 'Create your first case to get started'}
          </p>
          {!searchQuery && (
            <button
              onClick={() => setShowNewCaseModal(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg inline-flex items-center space-x-2"
            >
              <Plus size={18} />
              <span>Create Case</span>
            </button>
          )}
        </div>
      ) : (
        <div className="case-register">
          {cases.map((caseItem) => (
            <CaseCard
              key={caseItem.id}
              caseData={caseItem}
              onClick={() => onNavigateToCase(caseItem.id)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && !searchQuery && (
        <div className="flex items-center justify-between pt-4 border-t border-eagle-700">
          <span className="text-sm text-slate-400">
            Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, totalCases)} of {totalCases}
          </span>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-2 bg-eagle-700 hover:bg-eagle-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-white px-4">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-2 bg-eagle-700 hover:bg-eagle-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded transition-colors"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      )}

      {/* New Case Modal */}
      {showNewCaseModal && (
        <NewCaseModal
          user={user}
          onClose={() => setShowNewCaseModal(false)}
          onCreated={handleCaseCreated}
        />
      )}
    </div>
  );
};


// Case Card Component
interface CaseCardProps {
  caseData: Case;
  onClick: () => void;
}

const CaseCard: React.FC<CaseCardProps> = ({ caseData, onClick }) => {
  const statusStyle = statusColors[caseData.status];
  const priorityStyle = priorityColors[caseData.priority];

  return (
    <div
      onClick={onClick}
      role="button" tabIndex={0} aria-label={`Open case ${caseData.caseNumber}: ${caseData.title}`}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick(); } }}
      data-priority={caseData.priority}
      className="case-register-card border border-eagle-700 rounded-lg hover:border-blue-500/50 transition-all cursor-pointer group"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="case-badges flex items-center mb-2">
            <span className="text-xs font-mono text-blue-400 bg-blue-900/30 px-2 py-0.5 rounded">
              {caseData.caseNumber}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded border flex items-center space-x-1 ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}>
              {statusIcons[caseData.status]}
              <span>{caseData.status.replace('_', ' ')}</span>
            </span>
            <span className={`text-xs px-2 py-0.5 rounded border ${priorityStyle.bg} ${priorityStyle.text} ${priorityStyle.border}`}>
              {caseData.priority}
            </span>
          </div>
          <h3 className="text-white font-medium text-lg truncate group-hover:text-blue-400 transition-colors">
            {caseData.title}
          </h3>
          <p className="text-slate-400 text-sm mt-1 line-clamp-2">
            {caseData.description}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-eagle-700">
        <div className="flex items-center space-x-4 text-xs text-slate-500">
          <span className="flex items-center">
            <UserIcon size={12} className="mr-1" />
            {caseData.assignedOfficerId || 'Unassigned'}
          </span>
          <span className="flex items-center">
            <Calendar size={12} className="mr-1" />
            {new Date(caseData.createdAt).toLocaleDateString()}
          </span>
        </div>
        <span className="text-xs text-slate-500">
          Last activity: {new Date(caseData.lastActivityAt).toLocaleString()}
        </span>
      </div>
    </div>
  );
};

// Filter Panel Component
interface FilterPanelProps {
  statusFilter: CaseStatus | '';
  setStatusFilter: (status: CaseStatus | '') => void;
  priorityFilter: CasePriority | '';
  setPriorityFilter: (priority: CasePriority | '') => void;
  dateFromFilter: string;
  setDateFromFilter: (date: string) => void;
  dateToFilter: string;
  setDateToFilter: (date: string) => void;
  onApply: () => void;
  onClear: () => void;
}

const FilterPanel: React.FC<FilterPanelProps> = ({
  statusFilter,
  setStatusFilter,
  priorityFilter,
  setPriorityFilter,
  dateFromFilter,
  setDateFromFilter,
  dateToFilter,
  setDateToFilter,
  onApply,
  onClear
}) => {
  return (
    <div className="bg-eagle-800 border border-eagle-700 rounded-lg p-4">
      <div className="grid grid-cols-4 gap-4">
        {/* Status Filter */}
        <div>
          <label className="block text-xs text-slate-400 mb-2">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as CaseStatus | '')}
            className="w-full bg-eagle-900 border border-eagle-700 rounded px-3 py-2 text-white text-sm focus:border-blue-500 outline-none"
          >
            <option value="">All Statuses</option>
            {Object.values(CaseStatus).map((status) => (
              <option key={status} value={status}>
                {status.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>

        {/* Priority Filter */}
        <div>
          <label className="block text-xs text-slate-400 mb-2">Priority</label>
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as CasePriority | '')}
            className="w-full bg-eagle-900 border border-eagle-700 rounded px-3 py-2 text-white text-sm focus:border-blue-500 outline-none"
          >
            <option value="">All Priorities</option>
            {Object.values(CasePriority).map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
        </div>

        {/* Date From Filter */}
        <div>
          <label className="block text-xs text-slate-400 mb-2">From Date</label>
          <input
            type="date"
            value={dateFromFilter}
            onChange={(e) => setDateFromFilter(e.target.value)}
            className="w-full bg-eagle-900 border border-eagle-700 rounded px-3 py-2 text-white text-sm focus:border-blue-500 outline-none"
          />
        </div>

        {/* Date To Filter */}
        <div>
          <label className="block text-xs text-slate-400 mb-2">To Date</label>
          <input
            type="date"
            value={dateToFilter}
            onChange={(e) => setDateToFilter(e.target.value)}
            className="w-full bg-eagle-900 border border-eagle-700 rounded px-3 py-2 text-white text-sm focus:border-blue-500 outline-none"
          />
        </div>
      </div>

      <div className="flex justify-end space-x-3 mt-4 pt-4 border-t border-eagle-700">
        <button
          onClick={onClear}
          className="px-4 py-2 text-slate-400 hover:text-white transition-colors"
        >
          Clear Filters
        </button>
        <button
          onClick={onApply}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
        >
          Apply Filters
        </button>
      </div>
    </div>
  );
};

// New Case Modal Component
interface NewCaseModalProps {
  user: User;
  onClose: () => void;
  onCreated: (newCase: Case) => void;
}

const NewCaseModal: React.FC<NewCaseModalProps> = ({ user, onClose, onCreated }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<CasePriority>(CasePriority.MEDIUM);
  const [initialNotes, setInitialNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    if (!description.trim()) {
      setError('Description is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const input: CreateCaseInput = {
        title: title.trim(),
        description: description.trim(),
        priority,
        initialNotes: initialNotes.trim() || undefined
      };

      const newCase = await caseService.createCase(input, user.id);
      onCreated(newCase);
    } catch (err: any) {
      setError(err.message || 'Failed to create case');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-eagle-800 border border-eagle-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-eagle-700 flex justify-between items-center">
          <h3 className="text-lg font-bold text-white flex items-center">
            <Plus className="mr-2 text-blue-500" size={20} />
            Create New Case
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-900/30 border border-red-800 rounded p-3 flex items-center space-x-2">
              <AlertTriangle size={16} className="text-red-400" />
              <span className="text-red-400 text-sm">{error}</span>
            </div>
          )}

          <div>
            <label className="block text-sm text-slate-300 mb-2">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter case title..."
              className="w-full bg-eagle-900 border border-eagle-700 rounded px-4 py-2 text-white placeholder-slate-500 focus:border-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-2">Description *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the case..."
              rows={3}
              className="w-full bg-eagle-900 border border-eagle-700 rounded px-4 py-2 text-white placeholder-slate-500 focus:border-blue-500 outline-none resize-none"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-2">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as CasePriority)}
              className="w-full bg-eagle-900 border border-eagle-700 rounded px-4 py-2 text-white focus:border-blue-500 outline-none"
            >
              {Object.values(CasePriority).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-2">Initial Notes (Optional)</label>
            <textarea
              value={initialNotes}
              onChange={(e) => setInitialNotes(e.target.value)}
              placeholder="Add any initial notes..."
              rows={2}
              className="w-full bg-eagle-900 border border-eagle-700 rounded px-4 py-2 text-white placeholder-slate-500 focus:border-blue-500 outline-none resize-none"
            />
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t border-eagle-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded flex items-center space-x-2 transition-colors"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              <span>{loading ? 'Creating...' : 'Create Case'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
