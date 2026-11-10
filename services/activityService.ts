/**
 * Activity Service
 * 
 * Provides operations for logging activities, managing notes, and retrieving
 * unified timelines for investigation cases.
 */

import {
  CaseActivity,
  CaseNote,
  ActivityType,
  TimelineEntry
} from '../types';
import { supabase } from './supabase';
import { toCamelCase } from '../utils/caseConversion';

/**
 * Custom error class for activity operations
 */
export class ActivityError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: string
  ) {
    super(message);
    this.name = 'ActivityError';
  }
}

/**
 * Activity Service class for managing case activities and notes
 */
class ActivityService {
  /**
   * Logs an activity for a case
   * @param caseId The ID of the case
   * @param type The type of activity
   * @param officerId The ID of the officer performing the action
   * @param metadata Additional data for the activity
   * @returns The created activity log entry
   */
  async logActivity(
    caseId: string,
    type: ActivityType,
    officerId: string,
    metadata: Record<string, any> = {}
  ): Promise<CaseActivity> {
    // Verify case exists
    const { data: caseData, error: caseError } = await supabase
      .from('cases')
      .select('id')
      .eq('id', caseId)
      .single();
    
    if (caseError || !caseData) {
      throw new ActivityError(
        'Case not found',
        'CASE_NOT_FOUND',
        caseError?.message
      );
    }

    const now = new Date().toISOString();

    // Create activity log entry
    const activityData = {
      case_id: caseId,
      activity_type: type,
      officer_id: officerId,
      metadata: metadata,
      created_at: now
    };

    const { data: createdActivity, error: activityError } = await supabase
      .from('case_activities')
      .insert(activityData)
      .select()
      .single();

    if (activityError) {
      throw new ActivityError(
        'Failed to create activity log',
        'DATABASE_ERROR',
        activityError.message
      );
    }

    // Update case last_activity_at
    await supabase
      .from('cases')
      .update({ last_activity_at: now, updated_at: now })
      .eq('id', caseId);

    return toCamelCase(createdActivity) as unknown as CaseActivity;
  }

  /**
   * Adds a note to a case
   * @param caseId The ID of the case
   * @param officerId The ID of the officer adding the note
   * @param content The note content
   * @returns The created note
   */
  async addNote(
    caseId: string,
    officerId: string,
    content: string
  ): Promise<CaseNote> {
    // Validate content
    if (!content || content.trim() === '') {
      throw new ActivityError(
        'Note content is required',
        'VALIDATION_ERROR',
        'content'
      );
    }

    // Verify case exists
    const { data: caseData, error: caseError } = await supabase
      .from('cases')
      .select('id')
      .eq('id', caseId)
      .single();
    
    if (caseError || !caseData) {
      throw new ActivityError(
        'Case not found',
        'CASE_NOT_FOUND',
        caseError?.message
      );
    }

    const now = new Date().toISOString();

    // Create note
    const noteData = {
      case_id: caseId,
      officer_id: officerId,
      content: content.trim(),
      created_at: now
    };

    const { data: createdNote, error: noteError } = await supabase
      .from('case_notes')
      .insert(noteData)
      .select()
      .single();

    if (noteError) {
      throw new ActivityError(
        'Failed to create note',
        'DATABASE_ERROR',
        noteError.message
      );
    }

    // Create NOTE_ADDED activity log
    await this.logActivity(caseId, ActivityType.NOTE_ADDED, officerId, {
      noteId: createdNote.id,
      notePreview: content.trim().substring(0, 100)
    });

    return toCamelCase(createdNote) as unknown as CaseNote;
  }

  /**
   * Retrieves all activities for a case
   * @param caseId The ID of the case
   * @returns Array of activities sorted by timestamp descending
   */
  async getActivities(caseId: string): Promise<CaseActivity[]> {
    const { data, error } = await supabase
      .from('case_activities')
      .select('*')
      .eq('case_id', caseId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new ActivityError(
        'Failed to retrieve activities',
        'DATABASE_ERROR',
        error.message
      );
    }

    return (data || []).map(a => toCamelCase(a) as unknown as CaseActivity);
  }

  /**
   * Retrieves all notes for a case
   * @param caseId The ID of the case
   * @returns Array of notes sorted by timestamp descending
   */
  async getNotes(caseId: string): Promise<CaseNote[]> {
    const { data, error } = await supabase
      .from('case_notes')
      .select('*')
      .eq('case_id', caseId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new ActivityError(
        'Failed to retrieve notes',
        'DATABASE_ERROR',
        error.message
      );
    }

    return (data || []).map(n => toCamelCase(n) as unknown as CaseNote);
  }

  /**
   * Retrieves a unified timeline combining activities and notes
   * @param caseId The ID of the case
   * @returns Array of timeline entries sorted by timestamp descending
   */
  async getTimeline(caseId: string): Promise<TimelineEntry[]> {
    // Fetch activities and notes in parallel
    const [activities, notes] = await Promise.all([
      this.getActivities(caseId),
      this.getNotes(caseId)
    ]);

    // Convert activities to timeline entries
    const activityEntries: TimelineEntry[] = activities.map(activity => ({
      id: activity.id,
      type: 'activity' as const,
      timestamp: activity.createdAt,
      officerId: activity.officerId,
      content: activity.activityType,
      metadata: activity.metadata
    }));

    // Convert notes to timeline entries
    const noteEntries: TimelineEntry[] = notes.map(note => ({
      id: note.id,
      type: 'note' as const,
      timestamp: note.createdAt,
      officerId: note.officerId,
      content: note.content
    }));

    // Combine and sort by timestamp descending
    const timeline = [...activityEntries, ...noteEntries];
    timeline.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return timeB - timeA; // Descending order
    });

    return timeline;
  }
}

export const activityService = new ActivityService();
