/**
 * Watchlist Service
 * 
 * Manages Person of Interest (POI) entries for surveillance monitoring.
 * Handles POI registration, updates, soft deletion, and detection history.
 */

import { supabase } from './supabase';
import {
  WatchlistPOI,
  Detection,
  POIPriority,
  AddPOIInput,
  UpdatePOIInput,
  DetectionFilters
} from '../types';

// Convert snake_case DB row to camelCase WatchlistPOI
function toPOIModel(row: any): WatchlistPOI {
  return {
    id: row.id,
    faceToken: row.face_token,
    name: row.name,
    imageUrl: row.image_url,
    priority: row.priority as POIPriority,
    caseId: row.case_id || undefined,
    notes: row.notes || undefined,
    isActive: row.is_active,
    createdAt: row.created_at,
    createdBy: row.created_by
  };
}

// Convert snake_case DB row to camelCase Detection
function toDetectionModel(row: any): Detection {
  return {
    id: row.id,
    cameraId: row.camera_id,
    poiId: row.poi_id,
    snapshotUrl: row.snapshot_url,
    confidence: row.confidence,
    boundingBox: row.bounding_box,
    detectedAt: row.detected_at,
    metadata: row.metadata || {}
  };
}

/**
 * Get all POIs (optionally filter by active status)
 */
export async function getPOIs(activeOnly: boolean = true): Promise<WatchlistPOI[]> {
  let query = supabase
    .from('watchlist')
    .select('*')
    .order('priority', { ascending: true })
    .order('name', { ascending: true });

  if (activeOnly) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(toPOIModel);
}


/**
 * Get a single POI by ID
 */
export async function getPOI(id: string): Promise<WatchlistPOI | null> {
  const { data, error } = await supabase
    .from('watchlist')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data ? toPOIModel(data) : null;
}

/**
 * Get POI by face token
 */
export async function getPOIByFaceToken(faceToken: string): Promise<WatchlistPOI | null> {
  const { data, error } = await supabase
    .from('watchlist')
    .select('*')
    .eq('face_token', faceToken)
    .eq('is_active', true)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data ? toPOIModel(data) : null;
}

/**
 * Add a new POI to the watchlist
 */
export async function addPOI(input: AddPOIInput, createdBy: string): Promise<WatchlistPOI> {
  const { data, error } = await supabase
    .from('watchlist')
    .insert({
      face_token: input.faceToken,
      name: input.name,
      image_url: input.imageUrl || null,
      priority: input.priority || POIPriority.MEDIUM,
      case_id: input.caseId || null,
      notes: input.notes || null,
      is_active: true,
      created_by: createdBy
    })
    .select()
    .single();

  if (error) throw error;
  return toPOIModel(data);
}

/**
 * Update an existing POI
 */
export async function updatePOI(id: string, input: UpdatePOIInput): Promise<WatchlistPOI> {
  const updates: Record<string, any> = {};
  
  if (input.name !== undefined) updates.name = input.name;
  if (input.imageUrl !== undefined) updates.image_url = input.imageUrl;
  if (input.priority !== undefined) updates.priority = input.priority;
  if (input.caseId !== undefined) updates.case_id = input.caseId;
  if (input.notes !== undefined) updates.notes = input.notes;
  if (input.isActive !== undefined) updates.is_active = input.isActive;

  const { data, error } = await supabase
    .from('watchlist')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toPOIModel(data);
}

/**
 * Remove a POI from the watchlist (soft delete)
 * Sets is_active to false instead of hard deleting
 */
export async function removePOI(id: string): Promise<WatchlistPOI> {
  const { data, error } = await supabase
    .from('watchlist')
    .update({ is_active: false })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toPOIModel(data);
}

/**
 * Get detection history for a specific POI
 */
export async function getDetectionHistory(
  poiId: string,
  filters?: Partial<DetectionFilters>
): Promise<Detection[]> {
  let query = supabase
    .from('detections')
    .select('*')
    .eq('poi_id', poiId)
    .order('detected_at', { ascending: false });

  if (filters?.cameraId) {
    query = query.eq('camera_id', filters.cameraId);
  }
  if (filters?.dateFrom) {
    query = query.gte('detected_at', filters.dateFrom);
  }
  if (filters?.dateTo) {
    query = query.lte('detected_at', filters.dateTo);
  }
  if (filters?.minConfidence) {
    query = query.gte('confidence', filters.minConfidence);
  }
  if (filters?.pageSize) {
    const page = filters.page || 1;
    const offset = (page - 1) * filters.pageSize;
    query = query.range(offset, offset + filters.pageSize - 1);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(toDetectionModel);
}

/**
 * Get POIs by priority
 */
export async function getPOIsByPriority(priority: POIPriority): Promise<WatchlistPOI[]> {
  const { data, error } = await supabase
    .from('watchlist')
    .select('*')
    .eq('priority', priority)
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (error) throw error;
  return (data || []).map(toPOIModel);
}

/**
 * Get POIs linked to a specific case
 */
export async function getPOIsByCase(caseId: string): Promise<WatchlistPOI[]> {
  const { data, error } = await supabase
    .from('watchlist')
    .select('*')
    .eq('case_id', caseId)
    .eq('is_active', true)
    .order('priority', { ascending: true });

  if (error) throw error;
  return (data || []).map(toPOIModel);
}

/**
 * Get detection count for a POI
 */
export async function getDetectionCount(poiId: string): Promise<number> {
  const { count, error } = await supabase
    .from('detections')
    .select('*', { count: 'exact', head: true })
    .eq('poi_id', poiId);

  if (error) throw error;
  return count || 0;
}

/**
 * Get last detection for a POI
 */
export async function getLastDetection(poiId: string): Promise<Detection | null> {
  const { data, error } = await supabase
    .from('detections')
    .select('*')
    .eq('poi_id', poiId)
    .order('detected_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data ? toDetectionModel(data) : null;
}
