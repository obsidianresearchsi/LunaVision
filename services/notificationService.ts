/**
 * Notification Service
 * 
 * Provides operations for creating, retrieving, and managing notifications
 * for case-related events.
 */

import {
  Notification,
  NotificationType,
  CreateNotificationInput
} from '../types';
import { supabase } from './supabase';
import { toCamelCase } from '../utils/caseConversion';

/**
 * Custom error class for notification operations
 */
export class NotificationError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: string
  ) {
    super(message);
    this.name = 'NotificationError';
  }
}

/**
 * Notification Service class for managing case notifications
 */
class NotificationService {
  /**
   * Creates a new notification
   * @param input Notification creation input (userId, type, caseId, message)
   * @returns The created notification
   */
  async createNotification(input: CreateNotificationInput): Promise<Notification> {
    // Validate required fields
    if (!input.userId || input.userId.trim() === '') {
      throw new NotificationError(
        'User ID is required',
        'VALIDATION_ERROR',
        'userId'
      );
    }

    if (!input.caseId || input.caseId.trim() === '') {
      throw new NotificationError(
        'Case ID is required',
        'VALIDATION_ERROR',
        'caseId'
      );
    }


    if (!input.message || input.message.trim() === '') {
      throw new NotificationError(
        'Message is required',
        'VALIDATION_ERROR',
        'message'
      );
    }

    const now = new Date().toISOString();

    // Create notification record
    const notificationData = {
      user_id: input.userId.trim(),
      type: input.type,
      case_id: input.caseId.trim(),
      message: input.message.trim(),
      is_read: false,
      created_at: now
    };

    const { data: createdNotification, error } = await supabase
      .from('notifications')
      .insert(notificationData)
      .select()
      .single();

    if (error) {
      throw new NotificationError(
        'Failed to create notification',
        'DATABASE_ERROR',
        error.message
      );
    }

    return toCamelCase(createdNotification) as unknown as Notification;
  }

  /**
   * Retrieves all notifications for a user
   * @param userId The ID of the user
   * @returns Array of notifications sorted by creation date descending
   */
  async getNotifications(userId: string): Promise<Notification[]> {
    if (!userId || userId.trim() === '') {
      throw new NotificationError(
        'User ID is required',
        'VALIDATION_ERROR',
        'userId'
      );
    }

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new NotificationError(
        'Failed to retrieve notifications',
        'DATABASE_ERROR',
        error.message
      );
    }

    return (data || []).map(n => toCamelCase(n) as unknown as Notification);
  }

  /**
   * Gets the count of unread notifications for a user
   * @param userId The ID of the user
   * @returns The count of unread notifications
   */
  async getUnreadCount(userId: string): Promise<number> {
    if (!userId || userId.trim() === '') {
      throw new NotificationError(
        'User ID is required',
        'VALIDATION_ERROR',
        'userId'
      );
    }

    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      throw new NotificationError(
        'Failed to get unread count',
        'DATABASE_ERROR',
        error.message
      );
    }

    return count || 0;
  }

  /**
   * Marks a single notification as read
   * @param notificationId The ID of the notification to mark as read
   */
  async markAsRead(notificationId: string): Promise<void> {
    if (!notificationId || notificationId.trim() === '') {
      throw new NotificationError(
        'Notification ID is required',
        'VALIDATION_ERROR',
        'notificationId'
      );
    }

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId);

    if (error) {
      throw new NotificationError(
        'Failed to mark notification as read',
        'DATABASE_ERROR',
        error.message
      );
    }
  }

  /**
   * Marks all notifications as read for a user
   * @param userId The ID of the user
   */
  async markAllAsRead(userId: string): Promise<void> {
    if (!userId || userId.trim() === '') {
      throw new NotificationError(
        'User ID is required',
        'VALIDATION_ERROR',
        'userId'
      );
    }

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      throw new NotificationError(
        'Failed to mark all notifications as read',
        'DATABASE_ERROR',
        error.message
      );
    }
  }
}

export const notificationService = new NotificationService();
