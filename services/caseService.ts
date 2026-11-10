/**
 * Case Management Service
 * 
 * Provides operations for creating, managing, and querying investigation cases.
 * Integrates with Supabase backend for persistence.
 */

import {
  Case,
  CaseStatus,
  CasePriority,
  CaseActivity,
  ActivityType,
  CaseLinkedSubject,
  CaseLinkedSearch,
  CaseNote,
  CreateCaseInput,
  UpdateCaseInput,
  CaseFilters,
  PaginatedCases,
  CaseWithDetails,
  LinkSubjectInput,
  UserRole,
  NotificationType
} from '../types';
import { supabase } from './supabase';
import { toCamelCase } from '../utils/caseConversion';
import { notificationService } from './notificationService';

/**
 * Custom error class for case operations
 */
export class CaseError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: string
  ) {
    super(message);
    this.name = 'CaseError';
  }
}

/**
 * Valid status transitions map
 * OPEN → IN_PROGRESS → UNDER_REVIEW → CLOSED
 */
const STATUS_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  [CaseStatus.OPEN]: [CaseStatus.IN_PROGRESS],
  [CaseStatus.IN_PROGRESS]: [CaseStatus.UNDER_REVIEW],
  [CaseStatus.UNDER_REVIEW]: [CaseStatus.CLOSED],
  [CaseStatus.CLOSED]: []
};

/**
 * Generates a unique case number in format CASE-YYYYMMDD-XXXX
 * where XXXX is a 4-character alphanumeric sequence
 */
export async function generateCaseNumber(): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const datePrefix = `CASE-${year}${month}${day}`;
  
  // Generate random 4-character alphanumeric sequence
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let attempts = 0;
  const maxAttempts = 100;
  
  while (attempts < maxAttempts) {
    let sequence = '';
    for (let i = 0; i < 4; i++) {
      sequence += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    const caseNumber = `${datePrefix}-${sequence}`;
    
    // Check if this case number already exists
    const { data, error } = await supabase
      .from('cases')
      .select('id')
      .eq('case_number', caseNumber)
      .maybeSingle();
    
    if (error) {
      throw new CaseError(
        'Failed to check case number uniqueness',
        'CASE_NUMBER_CHECK_FAILED',
        error.message
      );
    }
    
    // If no existing case found, this number is unique
    if (!data) {
      return caseNumber;
    }
    
    attempts++;
  }
  
  throw new CaseError(
    'Failed to generate unique case number after maximum attempts',
    'CASE_NUMBER_GENERATION_FAILED'
  );
}

/**
 * Returns valid next statuses based on current status
 * @param currentStatus The current case status
 * @returns Array of valid next statuses
 */
export function getValidTransitions(currentStatus: CaseStatus): CaseStatus[] {
  return STATUS_TRANSITIONS[currentStatus] || [];
}


/**
 * Case Service class for managing investigation cases
 */
class CaseService {
  /**
   * Creates a new case with the provided input
   * @param input Case creation input (title, description, priority, initialNotes)
   * @param ownerId The ID of the officer creating the case
   * @returns The created case
   */
  async createCase(input: CreateCaseInput, ownerId: string): Promise<Case> {
    // Validate required fields
    if (!input.title || input.title.trim() === '') {
      throw new CaseError(
        'Title is required',
        'VALIDATION_ERROR',
        'title'
      );
    }
    
    if (!input.description || input.description.trim() === '') {
      throw new CaseError(
        'Description is required',
        'VALIDATION_ERROR',
        'description'
      );
    }
    
    // Generate unique case number
    const caseNumber = await generateCaseNumber();
    const now = new Date().toISOString();
    
    // Create case record
    const caseData = {
      case_number: caseNumber,
      title: input.title.trim(),
      description: input.description.trim(),
      status: CaseStatus.OPEN,
      priority: input.priority || CasePriority.MEDIUM,
      owner_id: ownerId,
      created_at: now,
      updated_at: now,
      last_activity_at: now
    };
    
    const { data: createdCase, error: caseError } = await supabase
      .from('cases')
      .insert(caseData)
      .select()
      .single();
    
    if (caseError) {
      throw new CaseError(
        'Failed to create case',
        'DATABASE_ERROR',
        caseError.message
      );
    }
    
    // Create initial CASE_CREATED activity log
    const activityData = {
      case_id: createdCase.id,
      activity_type: ActivityType.CASE_CREATED,
      officer_id: ownerId,
      metadata: {
        title: input.title.trim(),
        priority: input.priority || CasePriority.MEDIUM
      },
      created_at: now
    };
    
    const { error: activityError } = await supabase
      .from('case_activities')
      .insert(activityData);
    
    if (activityError) {
      // Log error but don't fail the case creation
      console.error('Failed to create activity log:', activityError);
    }
    
    // If initial notes provided, create a note
    if (input.initialNotes && input.initialNotes.trim()) {
      const noteData = {
        case_id: createdCase.id,
        officer_id: ownerId,
        content: input.initialNotes.trim(),
        created_at: now
      };
      
      await supabase.from('case_notes').insert(noteData);
      
      // Also log the note addition
      await supabase.from('case_activities').insert({
        case_id: createdCase.id,
        activity_type: ActivityType.NOTE_ADDED,
        officer_id: ownerId,
        metadata: { notePreview: input.initialNotes.trim().substring(0, 100) },
        created_at: now
      });
    }
    
    return toCamelCase(createdCase) as unknown as Case;
  }

  /**
   * Retrieves a single case with all related data
   * @param caseId The ID of the case to retrieve
   * @returns The case with all related data
   */
  async getCase(caseId: string): Promise<CaseWithDetails> {
    const { data: caseData, error: caseError } = await supabase
      .from('cases')
      .select('*')
      .eq('id', caseId)
      .single();
    
    if (caseError) {
      throw new CaseError(
        'Case not found',
        'CASE_NOT_FOUND',
        caseError.message
      );
    }
    
    // Fetch related data in parallel
    const [
      { data: linkedSubjects },
      { data: linkedSearches },
      { data: activities },
      { data: notes }
    ] = await Promise.all([
      supabase.from('case_linked_subjects').select('*').eq('case_id', caseId),
      supabase.from('case_linked_searches').select('*').eq('case_id', caseId),
      supabase.from('case_activities').select('*').eq('case_id', caseId).order('created_at', { ascending: false }),
      supabase.from('case_notes').select('*').eq('case_id', caseId).order('created_at', { ascending: false })
    ]);
    
    const caseResult = toCamelCase(caseData) as unknown as Case;
    
    return {
      ...caseResult,
      linkedSubjects: (linkedSubjects || []).map(s => toCamelCase(s) as unknown as CaseLinkedSubject),
      linkedSearches: (linkedSearches || []).map(s => toCamelCase(s) as unknown as CaseLinkedSearch),
      activities: (activities || []).map(a => toCamelCase(a) as unknown as CaseActivity),
      notes: (notes || []).map(n => toCamelCase(n) as unknown as CaseNote)
    };
  }


  /**
   * Retrieves a paginated list of cases with optional filters
   * @param filters Optional filters for status, priority, assigned officer, date range
   * @returns Paginated list of cases
   */
  async getCases(filters: CaseFilters = {}): Promise<PaginatedCases> {
    const page = filters.page || 1;
    const pageSize = filters.pageSize || 20;
    const offset = (page - 1) * pageSize;
    
    let query = supabase
      .from('cases')
      .select('*', { count: 'exact' });
    
    // Apply filters
    if (filters.status) {
      query = query.eq('status', filters.status);
    }
    
    if (filters.priority) {
      query = query.eq('priority', filters.priority);
    }
    
    if (filters.assignedOfficerId) {
      query = query.eq('assigned_officer_id', filters.assignedOfficerId);
    }
    
    if (filters.dateFrom) {
      query = query.gte('created_at', filters.dateFrom);
    }
    
    if (filters.dateTo) {
      query = query.lte('created_at', filters.dateTo);
    }
    
    // Default sort by last_activity_at DESC
    query = query.order('last_activity_at', { ascending: false });
    
    // Apply pagination
    query = query.range(offset, offset + pageSize - 1);
    
    const { data, error, count } = await query;
    
    if (error) {
      throw new CaseError(
        'Failed to retrieve cases',
        'DATABASE_ERROR',
        error.message
      );
    }
    
    return {
      cases: (data || []).map(c => toCamelCase(c) as unknown as Case),
      total: count || 0,
      page,
      pageSize
    };
  }

  /**
   * Searches cases by case number, title, or linked subject name
   * @param query The search query string
   * @returns Array of matching cases
   */
  async searchCases(query: string): Promise<Case[]> {
    if (!query || query.trim() === '') {
      return [];
    }
    
    const searchTerm = query.trim().toLowerCase();
    
    // Search in cases table by case_number and title
    const { data: casesData, error: casesError } = await supabase
      .from('cases')
      .select('*')
      .or(`case_number.ilike.%${searchTerm}%,title.ilike.%${searchTerm}%`)
      .order('last_activity_at', { ascending: false });
    
    if (casesError) {
      throw new CaseError(
        'Failed to search cases',
        'DATABASE_ERROR',
        casesError.message
      );
    }
    
    // Also search by linked subject name (requires joining with suspects table)
    const { data: linkedSubjectsData } = await supabase
      .from('case_linked_subjects')
      .select('case_id, suspect_face_token');
    
    // Get suspect names that match the search
    const { data: suspectsData } = await supabase
      .from('suspects')
      .select('face_token, name')
      .ilike('name', `%${searchTerm}%`);
    
    // Find case IDs that have linked subjects matching the search
    const matchingFaceTokens = new Set((suspectsData || []).map(s => s.face_token));
    const caseIdsFromSubjects = new Set(
      (linkedSubjectsData || [])
        .filter(ls => matchingFaceTokens.has(ls.suspect_face_token))
        .map(ls => ls.case_id)
    );
    
    // Get additional cases from subject matches
    if (caseIdsFromSubjects.size > 0) {
      const { data: additionalCases } = await supabase
        .from('cases')
        .select('*')
        .in('id', Array.from(caseIdsFromSubjects));
      
      // Merge results, avoiding duplicates
      const existingIds = new Set((casesData || []).map(c => c.id));
      const allCases = [...(casesData || [])];
      
      for (const c of (additionalCases || [])) {
        if (!existingIds.has(c.id)) {
          allCases.push(c);
        }
      }
      
      return allCases.map(c => toCamelCase(c) as unknown as Case);
    }
    
    return (casesData || []).map(c => toCamelCase(c) as unknown as Case);
  }


  /**
   * Returns valid next statuses based on current status
   * @param currentStatus The current case status
   * @returns Array of valid next statuses
   */
  getValidTransitions(currentStatus: CaseStatus): CaseStatus[] {
    return getValidTransitions(currentStatus);
  }

  /**
   * Changes the status of a case following the valid workflow
   * @param caseId The ID of the case to update
   * @param newStatus The new status to set
   * @param officerId The ID of the officer making the change
   * @param closingSummary Required when closing a case
   * @returns The updated case
   */
  async changeStatus(
    caseId: string,
    newStatus: CaseStatus,
    officerId: string,
    closingSummary?: string
  ): Promise<Case> {
    // Get current case
    const { data: currentCase, error: fetchError } = await supabase
      .from('cases')
      .select('*')
      .eq('id', caseId)
      .single();
    
    if (fetchError || !currentCase) {
      throw new CaseError(
        'Case not found',
        'CASE_NOT_FOUND',
        fetchError?.message
      );
    }
    
    const currentStatus = currentCase.status as CaseStatus;
    
    // Validate transition is allowed
    const validTransitions = getValidTransitions(currentStatus);
    if (!validTransitions.includes(newStatus)) {
      throw new CaseError(
        `Cannot change status from ${currentStatus} to ${newStatus}`,
        'INVALID_TRANSITION',
        `Valid transitions from ${currentStatus}: ${validTransitions.join(', ') || 'none'}`
      );
    }
    
    // Require closing summary for CLOSED status
    if (newStatus === CaseStatus.CLOSED) {
      if (!closingSummary || closingSummary.trim() === '') {
        throw new CaseError(
          'A closing summary is required to close this case',
          'CLOSING_SUMMARY_REQUIRED'
        );
      }
    }
    
    const now = new Date().toISOString();
    
    // Update case status
    const updateData: Record<string, any> = {
      status: newStatus,
      updated_at: now,
      last_activity_at: now
    };
    
    if (newStatus === CaseStatus.CLOSED && closingSummary) {
      updateData.closing_summary = closingSummary.trim();
    }
    
    const { data: updatedCase, error: updateError } = await supabase
      .from('cases')
      .update(updateData)
      .eq('id', caseId)
      .select()
      .single();
    
    if (updateError) {
      throw new CaseError(
        'Failed to update case status',
        'DATABASE_ERROR',
        updateError.message
      );
    }
    
    // Create STATUS_CHANGED activity log
    const activityData = {
      case_id: caseId,
      activity_type: ActivityType.STATUS_CHANGED,
      officer_id: officerId,
      metadata: {
        previousStatus: currentStatus,
        newStatus: newStatus,
        closingSummary: closingSummary?.trim()
      },
      created_at: now
    };
    
    const { error: activityError } = await supabase
      .from('case_activities')
      .insert(activityData);
    
    if (activityError) {
      console.error('Failed to create activity log:', activityError);
    }

    // Create notifications for status change
    const notificationMessage = `Case ${currentCase.case_number} status changed from ${currentStatus} to ${newStatus}`;
    const usersToNotify = new Set<string>();

    // Notify case owner (if not the one making the change)
    if (currentCase.owner_id && currentCase.owner_id !== officerId) {
      usersToNotify.add(currentCase.owner_id);
    }

    // Notify assigned officer (if exists and not the one making the change)
    if (currentCase.assigned_officer_id && currentCase.assigned_officer_id !== officerId) {
      usersToNotify.add(currentCase.assigned_officer_id);
    }

    // Create notifications for each user
    for (const userId of usersToNotify) {
      try {
        await notificationService.createNotification({
          userId,
          type: NotificationType.STATUS_CHANGED,
          caseId,
          message: notificationMessage
        });
      } catch (notifError) {
        // Log error but don't fail the status change
        console.error('Failed to create status change notification:', notifError);
      }
    }
    
    return toCamelCase(updatedCase) as unknown as Case;
  }

  /**
   * Updates a case with the provided data
   * Enforces closed case modification protection
   * @param caseId The ID of the case to update
   * @param data The update data
   * @param officerId The ID of the officer making the update
   * @param userRole The role of the user making the update
   * @returns The updated case
   */
  async updateCase(
    caseId: string,
    data: UpdateCaseInput,
    officerId: string,
    userRole: UserRole
  ): Promise<Case> {
    // Get current case
    const { data: currentCase, error: fetchError } = await supabase
      .from('cases')
      .select('*')
      .eq('id', caseId)
      .single();
    
    if (fetchError || !currentCase) {
      throw new CaseError(
        'Case not found',
        'CASE_NOT_FOUND',
        fetchError?.message
      );
    }
    
    // Check closed case modification protection
    if (currentCase.status === CaseStatus.CLOSED && userRole !== UserRole.CHIEF_COMMANDER) {
      throw new CaseError(
        'You do not have permission to modify this case',
        'UNAUTHORIZED_MODIFICATION',
        'Only CHIEF_COMMANDER can modify closed cases'
      );
    }
    
    const now = new Date().toISOString();
    
    // Build update object
    const updateData: Record<string, any> = {
      updated_at: now,
      last_activity_at: now
    };
    
    if (data.title !== undefined) {
      updateData.title = data.title.trim();
    }
    
    if (data.description !== undefined) {
      updateData.description = data.description.trim();
    }
    
    if (data.priority !== undefined) {
      updateData.priority = data.priority;
    }
    
    const { data: updatedCase, error: updateError } = await supabase
      .from('cases')
      .update(updateData)
      .eq('id', caseId)
      .select()
      .single();
    
    if (updateError) {
      throw new CaseError(
        'Failed to update case',
        'DATABASE_ERROR',
        updateError.message
      );
    }
    
    return toCamelCase(updatedCase) as unknown as Case;
  }

  /**
   * Links a subject (suspect) to a case
   * @param caseId The ID of the case
   * @param input Subject linking input (faceToken, confidence, matchType)
   * @param officerId The ID of the officer linking the subject
   * @returns The created link record
   */
  async linkSubject(
    caseId: string,
    input: LinkSubjectInput,
    officerId: string
  ): Promise<CaseLinkedSubject> {
    // Verify case exists
    const { data: caseData, error: caseError } = await supabase
      .from('cases')
      .select('id')
      .eq('id', caseId)
      .single();
    
    if (caseError || !caseData) {
      throw new CaseError(
        'Case not found',
        'CASE_NOT_FOUND',
        caseError?.message
      );
    }
    
    // Check for existing link (prevent duplicates)
    const { data: existingLink } = await supabase
      .from('case_linked_subjects')
      .select('id')
      .eq('case_id', caseId)
      .eq('suspect_face_token', input.suspectFaceToken)
      .maybeSingle();
    
    if (existingLink) {
      throw new CaseError(
        'Subject is already linked to this case',
        'DUPLICATE_LINK',
        `Face token ${input.suspectFaceToken} is already linked to case ${caseId}`
      );
    }
    
    const now = new Date().toISOString();
    
    // Create the link record
    const linkData = {
      case_id: caseId,
      suspect_face_token: input.suspectFaceToken,
      linked_by_officer_id: officerId,
      match_confidence: input.matchConfidence,
      match_type: input.matchType,
      linked_at: now
    };
    
    const { data: createdLink, error: linkError } = await supabase
      .from('case_linked_subjects')
      .insert(linkData)
      .select()
      .single();
    
    if (linkError) {
      throw new CaseError(
        'Failed to link subject to case',
        'DATABASE_ERROR',
        linkError.message
      );
    }
    
    // Update case last_activity_at
    await supabase
      .from('cases')
      .update({ last_activity_at: now, updated_at: now })
      .eq('id', caseId);
    
    // Create SUBJECT_LINKED activity log
    const activityData = {
      case_id: caseId,
      activity_type: ActivityType.SUBJECT_LINKED,
      officer_id: officerId,
      metadata: {
        suspectFaceToken: input.suspectFaceToken,
        matchConfidence: input.matchConfidence,
        matchType: input.matchType
      },
      created_at: now
    };
    
    await supabase.from('case_activities').insert(activityData);
    
    return toCamelCase(createdLink) as unknown as CaseLinkedSubject;
  }

  /**
   * Links a search (audit log) to a case
   * @param caseId The ID of the case
   * @param auditLogId The ID of the audit log to link
   * @param officerId The ID of the officer linking the search
   * @returns The created link record
   */
  async linkSearch(
    caseId: string,
    auditLogId: string,
    officerId: string
  ): Promise<CaseLinkedSearch> {
    // Verify case exists
    const { data: caseData, error: caseError } = await supabase
      .from('cases')
      .select('id')
      .eq('id', caseId)
      .single();
    
    if (caseError || !caseData) {
      throw new CaseError(
        'Case not found',
        'CASE_NOT_FOUND',
        caseError?.message
      );
    }
    
    // Check for existing link (prevent duplicates)
    const { data: existingLink } = await supabase
      .from('case_linked_searches')
      .select('id')
      .eq('case_id', caseId)
      .eq('audit_log_id', auditLogId)
      .maybeSingle();
    
    if (existingLink) {
      throw new CaseError(
        'Search is already linked to this case',
        'DUPLICATE_LINK',
        `Audit log ${auditLogId} is already linked to case ${caseId}`
      );
    }
    
    const now = new Date().toISOString();
    
    // Create the link record
    const linkData = {
      case_id: caseId,
      audit_log_id: auditLogId,
      linked_by_officer_id: officerId,
      linked_at: now
    };
    
    const { data: createdLink, error: linkError } = await supabase
      .from('case_linked_searches')
      .insert(linkData)
      .select()
      .single();
    
    if (linkError) {
      throw new CaseError(
        'Failed to link search to case',
        'DATABASE_ERROR',
        linkError.message
      );
    }
    
    // Update case last_activity_at
    await supabase
      .from('cases')
      .update({ last_activity_at: now, updated_at: now })
      .eq('id', caseId);
    
    // Create SEARCH_LINKED activity log
    const activityData = {
      case_id: caseId,
      activity_type: ActivityType.SEARCH_LINKED,
      officer_id: officerId,
      metadata: {
        auditLogId: auditLogId
      },
      created_at: now
    };
    
    await supabase.from('case_activities').insert(activityData);
    
    return toCamelCase(createdLink) as unknown as CaseLinkedSearch;
  }

  /**
   * Unlinks a subject from a case
   * @param caseId The ID of the case
   * @param suspectFaceToken The face token of the subject to unlink
   * @param officerId The ID of the officer unlinking the subject
   */
  async unlinkSubject(
    caseId: string,
    suspectFaceToken: string,
    officerId: string
  ): Promise<void> {
    // Verify case exists
    const { data: caseData, error: caseError } = await supabase
      .from('cases')
      .select('id')
      .eq('id', caseId)
      .single();
    
    if (caseError || !caseData) {
      throw new CaseError(
        'Case not found',
        'CASE_NOT_FOUND',
        caseError?.message
      );
    }
    
    // Check if link exists
    const { data: existingLink } = await supabase
      .from('case_linked_subjects')
      .select('id')
      .eq('case_id', caseId)
      .eq('suspect_face_token', suspectFaceToken)
      .maybeSingle();
    
    if (!existingLink) {
      throw new CaseError(
        'Subject is not linked to this case',
        'LINK_NOT_FOUND',
        `Face token ${suspectFaceToken} is not linked to case ${caseId}`
      );
    }
    
    // Delete the link
    const { error: deleteError } = await supabase
      .from('case_linked_subjects')
      .delete()
      .eq('case_id', caseId)
      .eq('suspect_face_token', suspectFaceToken);
    
    if (deleteError) {
      throw new CaseError(
        'Failed to unlink subject from case',
        'DATABASE_ERROR',
        deleteError.message
      );
    }
    
    const now = new Date().toISOString();
    
    // Update case last_activity_at
    await supabase
      .from('cases')
      .update({ last_activity_at: now, updated_at: now })
      .eq('id', caseId);
    
    // Create activity log for unlink action
    const activityData = {
      case_id: caseId,
      activity_type: ActivityType.SUBJECT_LINKED, // Using same type with 'unlinked' in metadata
      officer_id: officerId,
      metadata: {
        suspectFaceToken: suspectFaceToken,
        action: 'unlinked'
      },
      created_at: now
    };
    
    await supabase.from('case_activities').insert(activityData);
  }

  /**
   * Assigns an officer to a case
   * @param caseId The ID of the case
   * @param officerId The ID of the officer to assign
   * @param assignedByOfficerId The ID of the officer making the assignment
   * @returns The updated case
   */
  async assignOfficer(
    caseId: string,
    officerId: string,
    assignedByOfficerId: string
  ): Promise<Case> {
    // Verify case exists
    const { data: caseData, error: caseError } = await supabase
      .from('cases')
      .select('*')
      .eq('id', caseId)
      .single();
    
    if (caseError || !caseData) {
      throw new CaseError(
        'Case not found',
        'CASE_NOT_FOUND',
        caseError?.message
      );
    }

    const now = new Date().toISOString();
    const previousAssignee = caseData.assigned_officer_id;

    // Update case with assigned officer
    const { data: updatedCase, error: updateError } = await supabase
      .from('cases')
      .update({
        assigned_officer_id: officerId,
        updated_at: now,
        last_activity_at: now
      })
      .eq('id', caseId)
      .select()
      .single();

    if (updateError) {
      throw new CaseError(
        'Failed to assign officer',
        'DATABASE_ERROR',
        updateError.message
      );
    }

    // Create OFFICER_ASSIGNED activity log
    const activityData = {
      case_id: caseId,
      activity_type: ActivityType.OFFICER_ASSIGNED,
      officer_id: assignedByOfficerId,
      metadata: {
        assignedOfficerId: officerId,
        previousAssignee: previousAssignee || null
      },
      created_at: now
    };

    await supabase.from('case_activities').insert(activityData);

    // Create notification for the assigned officer
    try {
      await notificationService.createNotification({
        userId: officerId,
        type: NotificationType.CASE_ASSIGNED,
        caseId: caseId,
        message: `You have been assigned to case ${caseData.case_number}: ${caseData.title}`
      });
    } catch (notifError) {
      // Log error but don't fail the assignment
      console.error('Failed to create assignment notification:', notifError);
    }

    return toCamelCase(updatedCase) as unknown as Case;
  }
}

export const caseService = new CaseService();
