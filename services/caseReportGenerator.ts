/**
 * Case Report Generator
 * 
 * Generates formatted reports for investigation cases including case details,
 * linked subjects, timeline, and notes. Reports include Lunar Vision header
 * and CONFIDENTIAL classification marking.
 */

import {
  CaseWithDetails,
  CaseLinkedSubject,
  CaseActivity,
  CaseNote,
  TimelineEntry,
  ActivityType,
  CaseStatus,
  CasePriority
} from '../types';
import { formatSimilarity, similarityTier } from '../utils/similarityPresentation';

/**
 * Report sections that must be present in a generated report
 */
export interface CaseReportSections {
  header: boolean;
  caseDetails: boolean;
  linkedSubjects: boolean;
  timeline: boolean;
  notes: boolean;
}

/**
 * Generated report structure
 */
export interface CaseReport {
  content: string;
  generatedAt: string;
  caseId: string;
  caseNumber: string;
  sections: CaseReportSections;
}

// Activity type display names for report
const activityTypeLabels: Record<ActivityType, string> = {
  [ActivityType.CASE_CREATED]: 'Case Created',
  [ActivityType.STATUS_CHANGED]: 'Status Changed',
  [ActivityType.OFFICER_ASSIGNED]: 'Officer Assigned',
  [ActivityType.SUBJECT_LINKED]: 'Subject Linked',
  [ActivityType.SEARCH_LINKED]: 'Search Linked',
  [ActivityType.NOTE_ADDED]: 'Note Added',
  [ActivityType.REPORT_GENERATED]: 'Report Generated'
};

// Status display names
const statusLabels: Record<CaseStatus, string> = {
  [CaseStatus.OPEN]: 'Open',
  [CaseStatus.IN_PROGRESS]: 'In Progress',
  [CaseStatus.UNDER_REVIEW]: 'Under Review',
  [CaseStatus.CLOSED]: 'Closed'
};

// Priority display names
const priorityLabels: Record<CasePriority, string> = {
  [CasePriority.LOW]: 'Low',
  [CasePriority.MEDIUM]: 'Medium',
  [CasePriority.HIGH]: 'High',
  [CasePriority.CRITICAL]: 'Critical'
};


/**
 * Formats a date string for display in reports
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('en-NG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Generates the Lunar Vision header with classification marking
 */
function generateHeader(): string {
  return `
================================================================================
                        FEDERAL REPUBLIC OF NIGERIA
                    NIGERIA POLICE FORCE - INTELLIGENCE UNIT
                              LUNAR VISION SYSTEM
================================================================================
                              CONFIDENTIAL
                    OFFICIAL INVESTIGATION CASE REPORT
================================================================================
`;
}

/**
 * Generates the case details section
 */
function generateCaseDetailsSection(caseData: CaseWithDetails): string {
  let section = `
--------------------------------------------------------------------------------
                              CASE DETAILS
--------------------------------------------------------------------------------

Case Number:        ${caseData.caseNumber}
Title:              ${caseData.title}
Status:             ${statusLabels[caseData.status]}
Priority:           ${priorityLabels[caseData.priority]}

Description:
${caseData.description}

Case Owner:         ${caseData.ownerId}
Assigned Officer:   ${caseData.assignedOfficerId || 'Not Assigned'}

Created:            ${formatDate(caseData.createdAt)}
Last Updated:       ${formatDate(caseData.updatedAt)}
Last Activity:      ${formatDate(caseData.lastActivityAt)}
`;

  if (caseData.status === CaseStatus.CLOSED && caseData.closingSummary) {
    section += `
Closing Summary:
${caseData.closingSummary}
`;
  }

  return section;
}

/**
 * Generates the linked subjects section
 */
function generateLinkedSubjectsSection(subjects: CaseLinkedSubject[]): string {
  let section = `
--------------------------------------------------------------------------------
                           LINKED SUBJECTS (${subjects.length})
--------------------------------------------------------------------------------
`;

  if (subjects.length === 0) {
    section += `
No subjects linked to this case.
`;
  } else {
    subjects.forEach((subject, index) => {
      section += `
Subject ${index + 1}:
  Face Token:       ${subject.suspectFaceToken}
  Similarity Tier:  ${similarityTier(subject.matchType)}
  Provider Score:   ${formatSimilarity(subject.matchConfidence)}
  Interpretation:   Unverified record association; no identity or kinship conclusion
  Linked By:        ${subject.linkedByOfficerId}
  Linked At:        ${formatDate(subject.linkedAt)}
`;
    });
  }

  return section;
}


/**
 * Gets activity details from metadata
 */
function getActivityDetails(activity: CaseActivity): string {
  const metadata = activity.metadata || {};
  
  switch (activity.activityType) {
    case ActivityType.STATUS_CHANGED:
      return `Status changed from ${metadata.previousStatus} to ${metadata.newStatus}`;
    case ActivityType.OFFICER_ASSIGNED:
      return `Assigned to officer ${metadata.assignedOfficerId}`;
    case ActivityType.SUBJECT_LINKED:
      if (metadata.action === 'unlinked') {
        return `Subject unlinked: ${metadata.suspectFaceToken}`;
      }
      return `Record linked with ${formatSimilarity(metadata.matchConfidence)} provider similarity (${similarityTier(metadata.matchType)}); identity unverified`;
    case ActivityType.SEARCH_LINKED:
      return `Search session linked: ${metadata.auditLogId}`;
    case ActivityType.NOTE_ADDED:
      return metadata.notePreview || 'Note added';
    case ActivityType.CASE_CREATED:
      return `Case created with priority ${metadata.priority}`;
    case ActivityType.REPORT_GENERATED:
      return 'Report generated';
    default:
      return '';
  }
}

/**
 * Generates the timeline section combining activities and notes
 */
function generateTimelineSection(activities: CaseActivity[], notes: CaseNote[]): string {
  // Combine activities and notes into timeline entries
  const timelineEntries: Array<{
    timestamp: string;
    type: 'activity' | 'note';
    officerId: string;
    content: string;
  }> = [];

  // Add activities
  activities.forEach(activity => {
    timelineEntries.push({
      timestamp: activity.createdAt,
      type: 'activity',
      officerId: activity.officerId,
      content: `[${activityTypeLabels[activity.activityType]}] ${getActivityDetails(activity)}`
    });
  });

  // Add notes
  notes.forEach(note => {
    timelineEntries.push({
      timestamp: note.createdAt,
      type: 'note',
      officerId: note.officerId,
      content: note.content
    });
  });

  // Sort by timestamp descending (most recent first)
  timelineEntries.sort((a, b) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  let section = `
--------------------------------------------------------------------------------
                         ACTIVITY TIMELINE (${timelineEntries.length} entries)
--------------------------------------------------------------------------------
`;

  if (timelineEntries.length === 0) {
    section += `
No activity recorded for this case.
`;
  } else {
    timelineEntries.forEach((entry, index) => {
      const typeLabel = entry.type === 'note' ? '[NOTE]' : '[ACTIVITY]';
      section += `
${index + 1}. ${formatDate(entry.timestamp)}
   ${typeLabel} by ${entry.officerId}
   ${entry.content}
`;
    });
  }

  return section;
}

/**
 * Generates the notes section (separate from timeline for detailed view)
 */
function generateNotesSection(notes: CaseNote[]): string {
  let section = `
--------------------------------------------------------------------------------
                            CASE NOTES (${notes.length})
--------------------------------------------------------------------------------
`;

  if (notes.length === 0) {
    section += `
No notes recorded for this case.
`;
  } else {
    // Sort notes by timestamp descending
    const sortedNotes = [...notes].sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    sortedNotes.forEach((note, index) => {
      section += `
Note ${index + 1}:
  Date:     ${formatDate(note.createdAt)}
  Officer:  ${note.officerId}
  Content:
    ${note.content.split('\n').join('\n    ')}
`;
    });
  }

  return section;
}

/**
 * Generates the report footer
 */
function generateFooter(generatedAt: string): string {
  return `
================================================================================
                           END OF REPORT
================================================================================
Report Generated: ${formatDate(generatedAt)}
Classification: CONFIDENTIAL
This document contains sensitive information. Handle according to security protocols.
================================================================================
`;
}


/**
 * Case Report Generator class
 */
class CaseReportGenerator {
  /**
   * Generates a complete formatted report for a case
   * @param caseData The case with all related data
   * @returns The generated report
   */
  generateReport(caseData: CaseWithDetails): CaseReport {
    const generatedAt = new Date().toISOString();
    
    // Generate all sections
    const header = generateHeader();
    const caseDetails = generateCaseDetailsSection(caseData);
    const linkedSubjects = generateLinkedSubjectsSection(caseData.linkedSubjects);
    const timeline = generateTimelineSection(caseData.activities, caseData.notes);
    const notes = generateNotesSection(caseData.notes);
    const footer = generateFooter(generatedAt);
    
    // Combine all sections
    const content = [
      header,
      caseDetails,
      linkedSubjects,
      timeline,
      notes,
      footer
    ].join('');
    
    return {
      content,
      generatedAt,
      caseId: caseData.id,
      caseNumber: caseData.caseNumber,
      sections: {
        header: true,
        caseDetails: true,
        linkedSubjects: true,
        timeline: true,
        notes: true
      }
    };
  }

  /**
   * Validates that a report contains all required sections
   * @param report The report to validate
   * @returns True if all sections are present
   */
  validateReportSections(report: CaseReport): boolean {
    return (
      report.sections.header &&
      report.sections.caseDetails &&
      report.sections.linkedSubjects &&
      report.sections.timeline &&
      report.sections.notes
    );
  }

  /**
   * Checks if the report contains the official header
   * @param report The report to check
   * @returns True if the header is present with required elements
   */
  hasOfficialHeader(report: CaseReport): boolean {
    const content = report.content;
    return (
      content.includes('FEDERAL REPUBLIC OF NIGERIA') &&
      (content.includes('LUNAR VISION') || content.includes('EAGLEEYE')) &&
      content.includes('CONFIDENTIAL')
    );
  }

  /**
   * Checks if the report contains case details
   * @param report The report to check
   * @param caseData The original case data
   * @returns True if case details are present
   */
  hasCaseDetails(report: CaseReport, caseData: CaseWithDetails): boolean {
    const content = report.content;
    return (
      content.includes(caseData.caseNumber) &&
      content.includes(caseData.title) &&
      content.includes(caseData.description)
    );
  }

  /**
   * Checks if the report contains all linked subjects
   * @param report The report to check
   * @param subjects The linked subjects
   * @returns True if all subjects are present
   */
  hasAllLinkedSubjects(report: CaseReport, subjects: CaseLinkedSubject[]): boolean {
    const content = report.content;
    return subjects.every(subject => 
      content.includes(subject.suspectFaceToken)
    );
  }

  /**
   * Checks if the report contains timeline entries
   * @param report The report to check
   * @param activities The case activities
   * @param notes The case notes
   * @returns True if timeline is present
   */
  hasTimeline(report: CaseReport, activities: CaseActivity[], notes: CaseNote[]): boolean {
    const content = report.content;
    const hasTimelineSection = content.includes('ACTIVITY TIMELINE');
    
    // If there are activities or notes, they should be reflected
    if (activities.length > 0 || notes.length > 0) {
      return hasTimelineSection && content.includes('entries');
    }
    
    return hasTimelineSection;
  }

  /**
   * Checks if the report contains all notes
   * @param report The report to check
   * @param notes The case notes
   * @returns True if all notes are present
   */
  hasAllNotes(report: CaseReport, notes: CaseNote[]): boolean {
    const content = report.content;
    return notes.every(note => 
      content.includes(note.content.substring(0, 50)) // Check first 50 chars
    );
  }
}

export const caseReportGenerator = new CaseReportGenerator();


/**
 * Opens the print dialog for PDF export using browser print-to-PDF functionality
 * @param report The report to export
 */
export function exportReportToPDF(report: CaseReport): void {
  // Create a new window with the report content
  const printWindow = window.open('', '_blank');
  
  if (!printWindow) {
    throw new Error('Unable to open print window. Please check your popup blocker settings.');
  }
  
  printWindow.document.write(buildCaseReportHtml(report));
  printWindow.document.close();
  let printed = false;
  const printOnce = () => { if (!printed) { printed = true; printWindow.print(); } };
  printWindow.onload = printOnce;
  setTimeout(printOnce, 500);
}

/** Pure rendering: all user-authored case text is escaped before it enters HTML. */
export function buildCaseReportHtml(report: CaseReport): string {
  const sections = report.content.split(/^[=]{10,}\s*$/m).map(section => section.trim()).filter(Boolean);
  const blocks = sections.map((section, index) => `<section class="case-section"><div class="section-index">${String(index + 1).padStart(2, '0')}</div><pre>${escapeHtml(section.replace(/^[-]{10,}\s*$/gm, ''))}</pre></section>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Case Report - ${escapeHtml(report.caseNumber)}</title><style>
    *{box-sizing:border-box}body{margin:0;background:#e5edf1;color:#1b303e;font:12px/1.65 Arial,sans-serif}.document{max-width:850px;margin:32px auto;background:white;box-shadow:0 10px 45px #10253226}
    .masthead{border-top:6px solid #126b7d;background:#f3f8fa;padding:32px 40px;border-bottom:1px solid #d5e1e6}.eyebrow{font:10px monospace;letter-spacing:2px;color:#236b7a}h1{font-size:30px;letter-spacing:-1px;margin:8px 0} .meta{display:flex;justify-content:space-between;gap:20px;font-size:11px;color:#536b79}.classification{color:#984039;font-weight:bold;letter-spacing:1px}
    .content{padding:10px 40px 30px}.case-section{display:flex;gap:16px;padding:20px 0;border-bottom:1px solid #d9e4e8}.section-index{color:#127183;font:10px monospace;padding-top:4px}pre{font:12px/1.75 Arial,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;margin:0;min-width:0;flex:1}footer{padding:20px 40px;background:#f3f8fa;font-size:10px;color:#58717e}h1{break-after:avoid}
    @page{size:A4;margin:16mm}@media print{body{background:white}.document{margin:0;max-width:none;box-shadow:none}.masthead{padding:0 0 6mm}.content{padding:0}.case-section{padding:5mm 0}footer{padding:5mm 0}*{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  </style></head><body><main class="document"><div class="masthead"><div class="eyebrow">LUNAR VISION / CASE MANAGEMENT</div><h1>Case file report</h1><div class="meta"><span>${escapeHtml(report.caseNumber)} · ${escapeHtml(report.generatedAt)}</span><span class="classification">CONFIDENTIAL</span></div></div><div class="content">${blocks}</div><footer>LUNAR VISION · Case record export · Preserve original source records and analyst review history.</footer></main></body></html>`;
}

/**
 * Escapes HTML special characters to prevent XSS
 */
function escapeHtml(text: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  
  return text.replace(/[&<>"']/g, char => htmlEntities[char] || char);
}

/**
 * Downloads the report as a text file (alternative to PDF)
 * @param report The report to download
 */
export function downloadReportAsText(report: CaseReport): void {
  const blob = new Blob([report.content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = `${report.caseNumber}_Report_${new Date().toISOString().split('T')[0]}.txt`;
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
}
