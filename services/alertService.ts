/**
 * Alert Service
 * 
 * Manages surveillance alerts generated from POI detections.
 * Handles alert creation, acknowledgment, and case linking.
 */

import { supabase } from './supabase';
import {
  SurveillanceAlert,
  SurveillanceAlertWithDetails,
  AlertStatus,
  AlertFilters,
  Detection
} from '../types';

// Convert snake_case DB row to camelCase SurveillanceAlert
function toAlertModel(row: any): SurveillanceAlert {
  return {
    id: row.id,
    detectionId: row.detection_id,
    poiId: row.poi_id,
    cameraId: row.camera_id,
    status: row.status as AlertStatus,
    acknowledgedBy: row.acknowledged_by || undefined,
    acknowledgedAt: row.acknowledged_at || undefined,
    linkedCaseId: row.linked_case_id || undefined,
    createdAt: row.created_at
  };
}

// Convert with related data
function toAlertWithDetails(row: any): SurveillanceAlertWithDetails {
  const alert = toAlertModel(row);
  return {
    ...alert,
    detection: row.detections ? {
      id: row.detections.id,
      cameraId: row.detections.camera_id,
      poiId: row.detections.poi_id,
      snapshotUrl: row.detections.snapshot_url,
      confidence: row.detections.confidence,
      boundingBox: row.detections.bounding_box,
      detectedAt: row.detections.detected_at,
      metadata: row.detections.metadata || {}
    } : undefined,
    camera: row.cameras ? {
      id: row.cameras.id,
      name: row.cameras.name,
      description: row.cameras.description || '',
      streamUrl: row.cameras.stream_url,
      coordinates: { lat: row.cameras.lat, lng: row.cameras.lng },
      status: row.cameras.status,
      lastOnline: row.cameras.last_online,
      createdAt: row.cameras.created_at,
      updatedAt: row.cameras.updated_at
    } : undefined,
    poi: row.watchlist ? {
      id: row.watchlist.id,
      faceToken: row.watchlist.face_token,
      name: row.watchlist.name,
      imageUrl: row.watchlist.image_url,
      priority: row.watchlist.priority,
      caseId: row.watchlist.case_id,
      notes: row.watchlist.notes,
      isActive: row.watchlist.is_active,
      createdAt: row.watchlist.created_at,
      createdBy: row.watchlist.created_by
    } : undefined
  };
}


/**
 * Get all alerts with optional filtering
 */
export async function getAlerts(filters?: AlertFilters): Promise<SurveillanceAlert[]> {
  let query = supabase
    .from('surveillance_alerts')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters?.status) {
    query = query.eq('status', filters.status);
  }
  if (filters?.poiId) {
    query = query.eq('poi_id', filters.poiId);
  }
  if (filters?.cameraId) {
    query = query.eq('camera_id', filters.cameraId);
  }
  if (filters?.dateFrom) {
    query = query.gte('created_at', filters.dateFrom);
  }
  if (filters?.dateTo) {
    query = query.lte('created_at', filters.dateTo);
  }
  if (filters?.pageSize) {
    const page = filters.page || 1;
    const offset = (page - 1) * filters.pageSize;
    query = query.range(offset, offset + filters.pageSize - 1);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(toAlertModel);
}

/**
 * Get alerts with related data
 */
export async function getAlertsWithDetails(filters?: AlertFilters): Promise<SurveillanceAlertWithDetails[]> {
  let query = supabase
    .from('surveillance_alerts')
    .select(`
      *,
      detections (*),
      cameras (*),
      watchlist (*)
    `)
    .order('created_at', { ascending: false });

  if (filters?.status) {
    query = query.eq('status', filters.status);
  }
  if (filters?.poiId) {
    query = query.eq('poi_id', filters.poiId);
  }
  if (filters?.cameraId) {
    query = query.eq('camera_id', filters.cameraId);
  }
  if (filters?.dateFrom) {
    query = query.gte('created_at', filters.dateFrom);
  }
  if (filters?.dateTo) {
    query = query.lte('created_at', filters.dateTo);
  }
  if (filters?.pageSize) {
    const page = filters.page || 1;
    const offset = (page - 1) * filters.pageSize;
    query = query.range(offset, offset + filters.pageSize - 1);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(toAlertWithDetails);
}

/**
 * Get a single alert by ID
 */
export async function getAlert(id: string): Promise<SurveillanceAlert | null> {
  const { data, error } = await supabase
    .from('surveillance_alerts')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data ? toAlertModel(data) : null;
}

/**
 * Get unread alert count
 */
export async function getUnreadCount(): Promise<number> {
  const { count, error } = await supabase
    .from('surveillance_alerts')
    .select('*', { count: 'exact', head: true })
    .eq('status', AlertStatus.UNREAD);

  if (error) throw error;
  return count || 0;
}

/**
 * Acknowledge an alert
 */
export async function acknowledgeAlert(id: string, officerId: string): Promise<SurveillanceAlert> {
  const { data, error } = await supabase
    .from('surveillance_alerts')
    .update({
      status: AlertStatus.ACKNOWLEDGED,
      acknowledged_by: officerId,
      acknowledged_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toAlertModel(data);
}

/**
 * Mark alert as read
 */
export async function markAlertAsRead(id: string): Promise<SurveillanceAlert> {
  const { data, error } = await supabase
    .from('surveillance_alerts')
    .update({ status: AlertStatus.READ })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toAlertModel(data);
}

/**
 * Create an alert from a detection
 */
export async function createAlertFromDetection(
  detection: Detection,
  confidenceThreshold: number = 0.8
): Promise<SurveillanceAlert | null> {
  // Only create alert if confidence exceeds threshold
  if (detection.confidence < confidenceThreshold) {
    return null;
  }

  const { data, error } = await supabase
    .from('surveillance_alerts')
    .insert({
      detection_id: detection.id,
      poi_id: detection.poiId,
      camera_id: detection.cameraId,
      status: AlertStatus.UNREAD,
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) throw error;
  return toAlertModel(data);
}

/**
 * Link an alert to a case
 */
export async function linkAlertToCase(alertId: string, caseId: string): Promise<SurveillanceAlert> {
  const { data, error } = await supabase
    .from('surveillance_alerts')
    .update({
      status: AlertStatus.LINKED_TO_CASE,
      linked_case_id: caseId
    })
    .eq('id', alertId)
    .select()
    .single();

  if (error) throw error;
  return toAlertModel(data);
}

/**
 * Get alerts for a specific case
 */
export async function getAlertsByCase(caseId: string): Promise<SurveillanceAlert[]> {
  const { data, error } = await supabase
    .from('surveillance_alerts')
    .select('*')
    .eq('linked_case_id', caseId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(toAlertModel);
}

/**
 * Get recent unread alerts
 */
export async function getRecentUnreadAlerts(limit: number = 10): Promise<SurveillanceAlert[]> {
  const { data, error } = await supabase
    .from('surveillance_alerts')
    .select('*')
    .eq('status', AlertStatus.UNREAD)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []).map(toAlertModel);
}

/**
 * Mark all alerts as read for a user
 */
export async function markAllAlertsAsRead(): Promise<void> {
  const { error } = await supabase
    .from('surveillance_alerts')
    .update({ status: AlertStatus.READ })
    .eq('status', AlertStatus.UNREAD);

  if (error) throw error;
}
