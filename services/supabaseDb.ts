/**
 * Supabase Database Service
 * 
 * Provides async database operations for users, suspects, and audit logs
 * using Supabase as the backend. Maintains API compatibility with the
 * original localStorage-based DatabaseService.
 */

import { User, Suspect, AuditLog, UserRole } from '../types';
import { supabase } from './supabase';
import { toSnakeCase, toCamelCase } from '../utils/caseConversion';

/**
 * Custom error class for database operations
 */
export class DatabaseError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: string
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

/**
 * Supabase Database Service class
 */
class SupabaseDatabaseService {
  // --- User Operations ---

  /**
   * Retrieves all users from the database
   * @returns Promise<User[]> Array of all users
   */
  async getUsers(): Promise<User[]> {
    const { data, error } = await supabase
      .from('users')
      .select('*');

    if (error) {
      throw new DatabaseError(
        'Failed to retrieve users',
        error.code,
        error.message
      );
    }

    return (data || []).map(row => toCamelCase(row) as unknown as User);
  }

  /**
   * Adds a new user to the database
   * @param user The user to add
   */
  async addUser(user: User): Promise<void> {
    const snakeCaseUser = toSnakeCase(user as unknown as Record<string, unknown>);

    const { error } = await supabase
      .from('users')
      .insert(snakeCaseUser);

    if (error) {
      throw new DatabaseError(
        'Failed to add user',
        error.code,
        error.message
      );
    }
  }


  /**
   * Creates multiple officer users in a single batch operation
   * @param count Number of officers to create
   */
  async bulkCreateOfficers(count: number): Promise<void> {
    const users = await this.getUsers();
    const startIdx = users.length + 1;
    
    const newOfficers: Record<string, unknown>[] = [];
    const timestamp = Date.now();
    
    for (let i = 0; i < count; i++) {
      const user: User = {
        id: `off_${timestamp}_${i}`,
        username: `Officer_${(startIdx + i).toString().padStart(3, '0')}`,
        role: UserRole.OFFICER,
        createdAt: new Date().toISOString()
      };
      newOfficers.push(toSnakeCase(user as unknown as Record<string, unknown>));
    }

    if (newOfficers.length > 0) {
      const { error } = await supabase
        .from('users')
        .insert(newOfficers);

      if (error) {
        throw new DatabaseError(
          'Failed to bulk create officers',
          error.code,
          error.message
        );
      }
    }
  }

  // --- Suspect Operations ---

  /**
   * Retrieves all suspects from the database
   * @returns Promise<Suspect[]> Array of all suspects
   */
  async getSuspects(): Promise<Suspect[]> {
    const { data, error } = await supabase
      .from('suspects')
      .select('*');

    if (error) {
      throw new DatabaseError(
        'Failed to retrieve suspects',
        error.code,
        error.message
      );
    }

    return (data || []).map(row => toCamelCase(row) as unknown as Suspect);
  }

  /**
   * Adds a new suspect to the database
   * @param suspect The suspect to add
   */
  async addSuspect(suspect: Suspect): Promise<void> {
    const snakeCaseSuspect = toSnakeCase(suspect as unknown as Record<string, unknown>);

    const { error } = await supabase
      .from('suspects')
      .insert(snakeCaseSuspect);

    if (error) {
      throw new DatabaseError(
        'Failed to add suspect',
        error.code,
        error.message
      );
    }
  }

  /**
   * Updates an existing suspect in the database
   * @param suspect The suspect with updated fields
   */
  async updateSuspect(suspect: Suspect): Promise<void> {
    const snakeCaseSuspect = toSnakeCase(suspect as unknown as Record<string, unknown>);

    const { error } = await supabase
      .from('suspects')
      .update(snakeCaseSuspect)
      .eq('face_token', suspect.faceToken);

    if (error) {
      throw new DatabaseError(
        'Failed to update suspect',
        error.code,
        error.message
      );
    }
  }

  /**
   * Updates only the status field of a suspect
   * @param faceToken The face token identifying the suspect
   * @param status The new status value
   */
  async updateSuspectStatus(faceToken: string, status: Suspect['status']): Promise<void> {
    const { error } = await supabase
      .from('suspects')
      .update({ status })
      .eq('face_token', faceToken);

    if (error) {
      throw new DatabaseError(
        'Failed to update suspect status',
        error.code,
        error.message
      );
    }
  }

  // --- Audit Log Operations ---

  /**
   * Retrieves all audit logs from the database, ordered by timestamp descending (newest first)
   * @returns Promise<AuditLog[]> Array of audit logs
   */
  async getAuditLogs(options: { includeImages?: boolean; officerId?: string } = {}): Promise<AuditLog[]> {
    let query = supabase
      .from('audit_logs')
      .select(options.includeImages === false ? 'log_id,officer_id,timestamp,result_count,search_type' : '*')
      .order('timestamp', { ascending: false });
    if (options.officerId) query = query.eq('officer_id', options.officerId);
    const { data, error } = await query.returns<Record<string, unknown>[]>();

    if (error) {
      throw new DatabaseError(
        'Failed to retrieve audit logs',
        error.code,
        error.message
      );
    }

    return (data || []).map(row => ({ searchImagePath: '', ...toCamelCase(row) }) as unknown as AuditLog);
  }

  /** Fetch a saved image only when its record is visible or opened. */
  async getAuditImage(logId: string): Promise<string> {
    const { data, error } = await supabase.from('audit_logs')
      .select('search_image_path').eq('log_id', logId).single();
    if (error) throw new DatabaseError('Failed to load saved source image', error.code, error.message);
    return data?.search_image_path || '';
  }

  /**
   * Logs a search operation to the audit log
   * @param log The audit log entry to add
   */
  async logSearch(log: AuditLog): Promise<void> {
    const snakeCaseLog = toSnakeCase(log as unknown as Record<string, unknown>);

    const { error } = await supabase
      .from('audit_logs')
      .insert(snakeCaseLog);

    if (error) {
      throw new DatabaseError(
        'Failed to log search',
        error.code,
        error.message
      );
    }
  }
}

export const supabaseDb = new SupabaseDatabaseService();
