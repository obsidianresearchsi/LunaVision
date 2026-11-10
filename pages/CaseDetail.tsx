import React, { useState, useEffect, useCallback } from 'react';
import {
  Case,
  CaseStatus,
  CasePriority,
  CaseWithDetails,
  CaseLinkedSubject,
  TimelineEntry,
  ActivityType,
  User,
  UserRole
} from '../types';
import { caseService } from '../services/caseService';
import { activityService } from '../services/activityService';
import { caseReportGenerator, exportReportToPDF } from '../services/caseReportGenerator';
import { AssignOfficerModal } from '../components/AssignOfficerModal';
import { OperationsMetrics, CaseConnections } from '../components/OperationsUI';
import { supabase } from '../services/supabase';
import { formatSimilarity, similarityTier } from '../utils/similarityPresentation';
import {
  ArrowLeft,
  Briefcase,
  Clock,
  CheckCircle,
  FileText,
  User as UserIcon,
  Calendar,
  AlertTriangle,
  Loader2,
  ChevronRight,
  MessageSquare,
  Link2,
  Send,
  X,
  Image as ImageIcon,
  UserPlus,
  FileDown
} from 'lucide-react';

interface CaseDetailPageProps {
  caseId: string;
  user: User;
  onBack: () => void;
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
  [CaseStatus.OPEN]: <Clock size={14} />,
  [CaseStatus.IN_PROGRESS]: <Loader2 size={14} className="animate-spin" />,
  [CaseStatus.UNDER_REVIEW]: <FileText size={14} />,
  [CaseStatus.CLOSED]: <CheckCircle size={14} />
};


// Activity type display names
const activityTypeLabels: Record<ActivityType, string> = {
  [ActivityType.CASE_CREATED]: 'Case Created',
  [ActivityType.STATUS_CHANGED]: 'Status Changed',
  [ActivityType.OFFICER_ASSIGNED]: 'Officer Assigned',
  [ActivityType.SUBJECT_LINKED]: 'Subject Linked',
  [ActivityType.SEARCH_LINKED]: 'Search Linked',
  [ActivityType.NOTE_ADDED]: 'Note Added',
  [ActivityType.REPORT_GENERATED]: 'Report Generated'
};

export const CaseDetailPage: React.FC<CaseDetailPageProps> = ({ caseId, user, onBack }) => {
  const [caseData, setCaseData] = useState<CaseWithDetails | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Status change state
  const [changingStatus, setChangingStatus] = useState(false);
  const [showClosingModal, setShowClosingModal] = useState(false);
  const [closingSummary, setClosingSummary] = useState('');
  const [statusError, setStatusError] = useState<string | null>(null);
  
  // Note state
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  
  // Assign officer state
  const [showAssignModal, setShowAssignModal] = useState(false);
  
  // Report generation state
  const [generatingReport, setGeneratingReport] = useState(false);

  // Load case data
  const loadCase = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await caseService.getCase(caseId);
      setCaseData(data);
      
      // Load timeline
      const timelineData = await activityService.getTimeline(caseId);
      setTimeline(timelineData);
    } catch (err: any) {
      setError(err.message || 'Failed to load case');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    loadCase();
  }, [loadCase]);

  // Get valid status transitions
  const validTransitions = caseData ? caseService.getValidTransitions(caseData.status) : [];

  // Handle status change
  const handleStatusChange = async (newStatus: CaseStatus) => {
    if (!caseData) return;
    
    // If closing, show modal for summary
    if (newStatus === CaseStatus.CLOSED) {
      setShowClosingModal(true);
      return;
    }
    
    setChangingStatus(true);
    setStatusError(null);
    try {
      await caseService.changeStatus(caseId, newStatus, user.id);
      await loadCase();
    } catch (err: any) {
      setStatusError(err.message || 'Failed to change status');
    } finally {
      setChangingStatus(false);
    }
  };

  // Handle closing with summary
  const handleCloseCase = async () => {
    if (!closingSummary.trim()) {
      setStatusError('Closing summary is required');
      return;
    }
    
    setChangingStatus(true);
    setStatusError(null);
    try {
      await caseService.changeStatus(caseId, CaseStatus.CLOSED, user.id, closingSummary);
      setShowClosingModal(false);
      setClosingSummary('');
      await loadCase();
    } catch (err: any) {
      setStatusError(err.message || 'Failed to close case');
    } finally {
      setChangingStatus(false);
    }
  };

  // Handle adding note
  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    
    setAddingNote(true);
    try {
      await activityService.addNote(caseId, user.id, newNote);
      setNewNote('');
      await loadCase();
    } catch (err: any) {
      setError(err.message || 'Failed to add note');
    } finally {
      setAddingNote(false);
    }
  };

  // Handle assigning officer
  const handleAssignOfficer = async (officerId: string) => {
    await caseService.assignOfficer(caseId, officerId, user.id);
    await loadCase();
  };

  // Handle report generation
  const handleGenerateReport = async () => {
    if (!caseData) return;
    
    setGeneratingReport(true);
    try {
      // Generate the report
      const report = caseReportGenerator.generateReport(caseData);
      
      // Log the report generation activity
      await activityService.logActivity(
        caseId,
        ActivityType.REPORT_GENERATED,
        user.id,
        { reportGeneratedAt: report.generatedAt }
      );
      
      // Export to PDF using browser print dialog
      exportReportToPDF(report);
      
      // Refresh the case to show the new activity
      await loadCase();
    } catch (err: any) {
      setError(err.message || 'Failed to generate report');
    } finally {
      setGeneratingReport(false);
    }
  };

  // Format timestamp
  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  // Check if user can modify closed case
  const canModifyClosedCase = user.role === UserRole.CHIEF_COMMANDER;
  const isClosedAndRestricted = caseData?.status === CaseStatus.CLOSED && !canModifyClosedCase;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={32} className="animate-spin text-blue-500" />
      </div>
    );
  }

  if (error || !caseData) {
    return (
      <div className="space-y-4">
        <button
          onClick={onBack}
          className="flex items-center text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft size={18} className="mr-2" />
          Back to Cases
        </button>
        <div className="bg-red-900/30 border border-red-800 rounded-lg p-4 flex items-center space-x-3">
          <AlertTriangle className="text-red-400" size={20} />
          <span className="text-red-400">{error || 'Case not found'}</span>
        </div>
      </div>
    );
  }

  const statusStyle = statusColors[caseData.status];
  const priorityStyle = priorityColors[caseData.priority];

  return (
    <div className="ops-page space-y-6" data-accent="violet">
      {/* Back Button */}
      <button
        onClick={onBack}
        className="flex items-center text-slate-400 hover:text-white transition-colors"
      >
        <ArrowLeft size={18} className="mr-2" />
        Back to Cases
      </button>

      {/* Case Header */}
      <div className="case-file-header border border-eagle-700 rounded-lg">
        <p className="ops-eyebrow mb-4">INVESTIGATION DOSSIER / CASE FILE</p>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center space-x-3 mb-3">
              <span className="text-sm font-mono text-blue-400 bg-blue-900/30 px-3 py-1 rounded">
                {caseData.caseNumber}
              </span>
              <span className={`text-sm px-3 py-1 rounded border flex items-center space-x-1.5 ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}>
                {statusIcons[caseData.status]}
                <span>{caseData.status.replace('_', ' ')}</span>
              </span>
              <span className={`text-sm px-3 py-1 rounded border ${priorityStyle.bg} ${priorityStyle.text} ${priorityStyle.border}`}>
                {caseData.priority}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">{caseData.title}</h1>
            <p className="text-slate-400">{caseData.description}</p>
          </div>
          <Briefcase className="text-blue-500" size={32} />
        </div>

        {/* Case Metadata */}
        <div className="case-file-metadata mt-6 pt-4 border-t border-eagle-700">
          <div className="flex items-center space-x-6 text-sm text-slate-400">
            <span className="flex items-center">
              <UserIcon size={14} className="mr-2" />
              Owner: {caseData.ownerId}
            </span>
            {caseData.assignedOfficerId && (
              <span className="flex items-center">
                <UserIcon size={14} className="mr-2" />
                Assigned: {caseData.assignedOfficerId}
              </span>
            )}
            <span className="flex items-center">
              <Calendar size={14} className="mr-2" />
              Created: {formatTimestamp(caseData.createdAt)}
            </span>
            <span className="flex items-center">
              <Clock size={14} className="mr-2" />
              Last Activity: {formatTimestamp(caseData.lastActivityAt)}
            </span>
          </div>
          
          <div className="flex items-center space-x-2">
            {/* Generate Report Button */}
            <button
              onClick={handleGenerateReport}
              disabled={generatingReport}
              className="px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg flex items-center space-x-2 text-sm transition-colors"
            >
              {generatingReport ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <FileDown size={14} />
              )}
              <span>{generatingReport ? 'Generating...' : 'Generate Report'}</span>
            </button>
            
            {/* Assign Officer Button - Only visible to CHIEF_COMMANDER */}
            {user.role === UserRole.CHIEF_COMMANDER && !isClosedAndRestricted && (
              <button
                onClick={() => setShowAssignModal(true)}
                className="px-3 py-1.5 bg-eagle-700 hover:bg-eagle-600 text-white rounded-lg flex items-center space-x-2 text-sm transition-colors"
              >
                <UserPlus size={14} />
                <span>{caseData.assignedOfficerId ? 'Reassign' : 'Assign Officer'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Closing Summary (if closed) */}
        {caseData.status === CaseStatus.CLOSED && caseData.closingSummary && (
          <div className="mt-4 p-4 bg-slate-900/50 border border-slate-700 rounded-lg">
            <h4 className="text-sm font-medium text-slate-300 mb-2">Closing Summary</h4>
            <p className="text-slate-400">{caseData.closingSummary}</p>
          </div>
        )}
      </div>
      <OperationsMetrics items={[
        { label: 'Linked subjects', value: caseData.linkedSubjects.length, detail: 'Saved subject associations', tone: 'red' },
        { label: 'Search sessions', value: caseData.linkedSearches.length, detail: 'Linked audit records' },
        { label: 'Investigator notes', value: caseData.notes.length, tone: 'violet' },
        { label: 'Timeline entries', value: timeline.length, detail: 'Activities and notes', tone: 'amber' }
      ]}/>
      <CaseConnections caseData={caseData}/>
      <div className="case-status-track" aria-label="Case lifecycle">{Object.values(CaseStatus).map((status, index) =>
        <div key={status} data-current={caseData.status === status} aria-current={caseData.status === status ? 'step' : undefined}>
          <span>{String(index + 1).padStart(2, '0')}</span><strong>{status.replace(/_/g, ' ')}</strong>{caseData.status === status && <small>CURRENT</small>}
        </div>)}</div>

      {/* Status Change Section */}
      {!isClosedAndRestricted && validTransitions.length > 0 && (
        <div className="bg-eagle-800 border border-eagle-700 rounded-lg p-4">
          <h3 className="text-sm font-medium text-slate-300 mb-3">Change Status</h3>
          {statusError && (
            <div className="mb-3 bg-red-900/30 border border-red-800 rounded p-2 flex items-center space-x-2">
              <AlertTriangle size={14} className="text-red-400" />
              <span className="text-red-400 text-sm">{statusError}</span>
            </div>
          )}
          <div className="flex items-center space-x-3">
            {validTransitions.map((status) => (
              <button
                key={status}
                onClick={() => handleStatusChange(status)}
                disabled={changingStatus}
                className="px-4 py-2 bg-eagle-700 hover:bg-eagle-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg flex items-center space-x-2 transition-colors"
              >
                {changingStatus && <Loader2 size={14} className="animate-spin" />}
                <ChevronRight size={14} />
                <span>Move to {status.replace('_', ' ')}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Content Grid */}
      <div className="case-file-grid">
        {/* Left Column - Linked Subjects */}
        <div className="space-y-4">
          <LinkedSubjectsSection 
            subjects={caseData.linkedSubjects} 
            caseId={caseId}
            onRefresh={loadCase}
          />
          <section className="ops-panel" id="case-linked-searches">
            <div className="ops-panel-heading"><div><FileText size={15}/><h2>Linked search sessions</h2></div><span>{caseData.linkedSearches.length}</span></div>
            <div className="p-4">{caseData.linkedSearches.length ? caseData.linkedSearches.map(search =>
              <div className="case-linked-session" key={search.id}><strong>{search.auditLogId}</strong><span>Linked by {search.linkedByOfficerId}</span><span>{formatTimestamp(search.linkedAt)}</span></div>) :
              <p className="ops-muted">No searches linked. Use “Link Search to Case” from results or search history.</p>}</div>
          </section>
        </div>

        {/* Right Column - Timeline and Notes */}
        <div className="space-y-6">
          {/* Add Note Form */}
          {!isClosedAndRestricted && (
            <div className="bg-eagle-800 border border-eagle-700 rounded-lg p-4">
              <h3 className="text-sm font-medium text-slate-300 mb-3 flex items-center">
                <MessageSquare size={16} className="mr-2" />
                Add Note
              </h3>
              <div className="flex space-x-3">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Enter your note..."
                  rows={2}
                  className="flex-1 bg-eagle-900 border border-eagle-700 rounded px-4 py-2 text-white placeholder-slate-500 focus:border-blue-500 outline-none resize-none"
                />
                <button
                  onClick={handleAddNote}
                  disabled={addingNote || !newNote.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg flex items-center space-x-2 transition-colors self-end"
                >
                  {addingNote ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  <span>Add</span>
                </button>
              </div>
            </div>
          )}

          {/* Timeline Section */}
          <TimelineSection timeline={timeline} />
        </div>
      </div>

      {/* Closing Summary Modal */}
      {showClosingModal && (
        <ClosingSummaryModal
          onClose={() => {
            setShowClosingModal(false);
            setClosingSummary('');
            setStatusError(null);
          }}
          onSubmit={handleCloseCase}
          summary={closingSummary}
          setSummary={setClosingSummary}
          loading={changingStatus}
          error={statusError}
        />
      )}

      {/* Assign Officer Modal - Only for CHIEF_COMMANDER */}
      {showAssignModal && caseData && (
        <AssignOfficerModal
          caseId={caseId}
          caseNumber={caseData.caseNumber}
          currentAssigneeId={caseData.assignedOfficerId}
          onAssign={handleAssignOfficer}
          onClose={() => setShowAssignModal(false)}
        />
      )}
    </div>
  );
};

// Linked Subjects Section Component
interface LinkedSubjectsSectionProps {
  subjects: CaseLinkedSubject[];
  caseId: string;
  onRefresh: () => void;
}

const LinkedSubjectsSection: React.FC<LinkedSubjectsSectionProps> = ({ subjects, caseId, onRefresh }) => {
  const [profiles, setProfiles] = useState<Record<string, LinkedSubjectProfile>>({});
  const [profileError, setProfileError] = useState(false);
  useEffect(() => {
    let active = true;
    setProfiles({});
    setProfileError(false);
    if (subjects.length) {
      const loadProfiles = async () => {
        try {
          const { data, error } = await supabase.from('suspects')
            .select('face_token,name,image_url,crime,location,status')
            .in('face_token', subjects.map(subject => subject.suspectFaceToken));
          if (error) throw error;
          if (active) setProfiles(Object.fromEntries((data || []).map(profile => [profile.face_token, profile])));
        } catch { if (active) setProfileError(true); }
      };
      loadProfiles();
    }
    return () => { active = false; };
  }, [subjects]);
  return (
    <div id="case-linked-subjects" className="bg-eagle-800 border border-eagle-700 rounded-lg p-4">
      <h3 className="text-sm font-medium text-slate-300 mb-4 flex items-center justify-between">
        <span className="flex items-center">
          <Link2 size={16} className="mr-2" />
          Linked Subjects ({subjects.length})
        </span>
      </h3>
      {profileError && <p className="text-amber-400 text-xs mb-3">Subject profiles unavailable. Saved link details are shown below.</p>}
      
      {subjects.length === 0 ? (
        <div className="text-center py-8">
          <ImageIcon size={32} className="mx-auto text-slate-500 mb-3" />
          <p className="text-slate-400 text-sm">No subjects linked yet</p>
          <p className="text-slate-500 text-xs mt-1">
            Link subjects from search results using "Add to Case"
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {subjects.map((subject) => (
            <LinkedSubjectCard key={subject.id} subject={subject} profile={profiles[subject.suspectFaceToken]} />
          ))}
        </div>
      )}
    </div>
  );
};

// Linked Subject Card Component
interface LinkedSubjectCardProps {
  subject: CaseLinkedSubject;
  profile?: LinkedSubjectProfile;
}
interface LinkedSubjectProfile { face_token: string; name: string; image_url: string; crime: string; location: string; status: string | null; }

const LinkedSubjectCard: React.FC<LinkedSubjectCardProps> = ({ subject, profile }) => {
  const confidenceColor = 'text-blue-300';

  return (
    <div className="bg-eagle-900 border border-eagle-700 rounded-lg p-3">
      <div className="flex items-center space-x-3">
        <div className="w-12 h-12 bg-slate-700 rounded-lg flex items-center justify-center">
          {profile?.image_url ? <img src={profile.image_url} alt={profile.name} className="w-full h-full object-cover rounded"/> : <ImageIcon size={20} className="text-slate-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-medium truncate">
            {profile?.name || `${subject.suspectFaceToken.substring(0, 12)}...`}
          </p>
          <div className="flex items-center space-x-2 mt-1">
            <span className={`text-xs ${confidenceColor}`}>
              {formatSimilarity(subject.matchConfidence)} similarity
            </span>
            <span className="text-xs text-slate-500">•</span>
            <span className="text-xs text-slate-400">{similarityTier(subject.matchType)}</span>
          </div>
        </div>
      </div>
      {profile && <p className="ops-muted mt-3">{profile.crime}<br/>{profile.location} · {profile.status?.replace(/_/g, ' ') || 'Status not recorded'}</p>}
      <div className="mt-2 pt-2 border-t border-eagle-700 text-xs text-slate-500">
        Linked: {new Date(subject.linkedAt).toLocaleDateString()}
        <p className="mt-1 break-all font-mono text-[9px]">{subject.suspectFaceToken}</p>
        <p className="mt-1">Linked by {subject.linkedByOfficerId}</p>
      </div>
    </div>
  );
};


// Timeline Section Component
interface TimelineSectionProps {
  timeline: TimelineEntry[];
}

const TimelineSection: React.FC<TimelineSectionProps> = ({ timeline }) => {
  return (
    <div className="bg-eagle-800 border border-eagle-700 rounded-lg p-4">
      <h3 className="text-sm font-medium text-slate-300 mb-4 flex items-center">
        <Clock size={16} className="mr-2" />
        Activity Timeline ({timeline.length})
      </h3>
      
      {timeline.length === 0 ? (
        <div className="text-center py-8">
          <Clock size={32} className="mx-auto text-slate-500 mb-3" />
          <p className="text-slate-400 text-sm">No activity yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {timeline.map((entry, index) => (
            <TimelineEntryCard key={entry.id} entry={entry} isLast={index === timeline.length - 1} />
          ))}
        </div>
      )}
    </div>
  );
};

// Timeline Entry Card Component
interface TimelineEntryCardProps {
  entry: TimelineEntry;
  isLast: boolean;
}

const TimelineEntryCard: React.FC<TimelineEntryCardProps> = ({ entry, isLast }) => {
  const isNote = entry.type === 'note';
  
  // Get activity label
  const getActivityLabel = () => {
    if (isNote) return String(entry.content).startsWith('[ANALYST REVIEW / v1]') ? 'Analyst review' : 'Note';
    const activityType = entry.content as ActivityType;
    return activityTypeLabels[activityType] || entry.content;
  };

  // Get activity details from metadata
  const getActivityDetails = () => {
    if (isNote) return entry.content as string;
    
    const metadata = entry.metadata || {};
    const activityType = entry.content as ActivityType;
    
    switch (activityType) {
      case ActivityType.STATUS_CHANGED:
        return `${metadata.previousStatus} → ${metadata.newStatus}`;
      case ActivityType.OFFICER_ASSIGNED:
        return `Assigned to ${metadata.assignedOfficerId}`;
      case ActivityType.SUBJECT_LINKED:
        if (metadata.action === 'unlinked') {
          return `Subject unlinked`;
        }
        return `Record linked with ${formatSimilarity(metadata.matchConfidence)} provider similarity; identity unverified`;
      case ActivityType.SEARCH_LINKED:
        return `Search session linked`;
      case ActivityType.NOTE_ADDED:
        return metadata.notePreview || 'Note added';
      case ActivityType.CASE_CREATED:
        return `Case created with priority ${metadata.priority}`;
      case ActivityType.REPORT_GENERATED:
        return 'Report generated';
      default:
        return '';
    }
  };

  return (
    <div className="relative flex">
      {/* Timeline line */}
      {!isLast && (
        <div className="absolute left-4 top-8 bottom-0 w-0.5 bg-eagle-700" />
      )}
      
      {/* Icon */}
      <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center ${
        isNote 
          ? 'bg-blue-900/50 border border-blue-800' 
          : 'bg-eagle-700 border border-eagle-600'
      }`}>
        {isNote ? (
          <MessageSquare size={14} className="text-blue-400" />
        ) : (
          <FileText size={14} className="text-slate-400" />
        )}
      </div>
      
      {/* Content */}
      <div className="ml-4 flex-1 pb-4">
        <div className="flex items-center justify-between mb-1">
          <span className={`text-sm font-medium ${isNote ? 'text-blue-400' : 'text-slate-300'}`}>
            {getActivityLabel()}
          </span>
          <span className="text-xs text-slate-500">
            {new Date(entry.timestamp).toLocaleString()}
          </span>
        </div>
        <p className="text-sm text-slate-400 whitespace-pre-wrap break-words">{getActivityDetails()}</p>
        <p className="text-xs text-slate-500 mt-1">by {entry.officerId}</p>
      </div>
    </div>
  );
};

// Closing Summary Modal Component
interface ClosingSummaryModalProps {
  onClose: () => void;
  onSubmit: () => void;
  summary: string;
  setSummary: (summary: string) => void;
  loading: boolean;
  error: string | null;
}

const ClosingSummaryModal: React.FC<ClosingSummaryModalProps> = ({
  onClose,
  onSubmit,
  summary,
  setSummary,
  loading,
  error
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-eagle-800 border border-eagle-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-eagle-700 flex justify-between items-center">
          <h3 className="text-lg font-bold text-white flex items-center">
            <CheckCircle className="mr-2 text-green-500" size={20} />
            Close Case
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="bg-red-900/30 border border-red-800 rounded p-3 flex items-center space-x-2">
              <AlertTriangle size={16} className="text-red-400" />
              <span className="text-red-400 text-sm">{error}</span>
            </div>
          )}

          <div>
            <label className="block text-sm text-slate-300 mb-2">
              Closing Summary <span className="text-red-400">*</span>
            </label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Provide a summary of the case resolution..."
              rows={4}
              className="w-full bg-eagle-900 border border-eagle-700 rounded px-4 py-2 text-white placeholder-slate-500 focus:border-blue-500 outline-none resize-none"
            />
            <p className="text-xs text-slate-500 mt-1">
              A closing summary is required to close this case.
            </p>
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
              onClick={onSubmit}
              disabled={loading || !summary.trim()}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded flex items-center space-x-2 transition-colors"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              <span>{loading ? 'Closing...' : 'Close Case'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
