/**
 * Detection Service
 * 
 * Handles face detection processing, storage, and retrieval.
 * Compares detected faces against the active watchlist.
 */

import { supabase } from './supabase';
import {
  Detection,
  DetectionWithDetails,
  DetectionFilters,
  WatchlistPOI,
  Camera
} from '../types';
import { getPOIs } from './watchlistService';

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

// Convert with related data
function toDetectionWithDetails(row: any): DetectionWithDetails {
  const detection = toDetectionModel(row);
  return {
    ...detection,
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
 * Process a frame and compare against active watchlist
 * Returns any matches found
 */
export interface FrameProcessResult {
  poiId: string;
  confidence: number;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
}

export async function processFrame(
  cameraId: string,
  snapshotUrl: string,
  detectedFaces: Array<{
    faceToken: string;
    confidence: number;
    boundingBox?: { x: number; y: number; width: number; height: number };
  }>
): Promise<Detection[]> {
  // Get active watchlist POIs
  const activePOIs = await getPOIs(true);
  const poiByToken = new Map(activePOIs.map(poi => [poi.faceToken, poi]));

  const detections: Detection[] = [];

  for (const face of detectedFaces) {
    const matchedPOI = poiByToken.get(face.faceToken);
    if (matchedPOI) {
      // Create detection record
      const { data, error } = await supabase
        .from('detections')
        .insert({
          camera_id: cameraId,
          poi_id: matchedPOI.id,
          snapshot_url: snapshotUrl,
          confidence: face.confidence,
          bounding_box: face.boundingBox || null,
          detected_at: new Date().toISOString(),
          metadata: {}
        })
        .select()
        .single();

      if (error) throw error;
      detections.push(toDetectionModel(data));
    }
  }

  return detections;
}

/**
 * Get all detections with optional filtering
 */
export async function getDetections(filters?: DetectionFilters): Promise<Detection[]> {
  let query = supabase
    .from('detections')
    .select('*')
    .order('detected_at', { ascending: false });

  if (filters?.poiId) {
    query = query.eq('poi_id', filters.poiId);
  }
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
 * Get a single detection by ID
 */
export async function getDetection(id: string): Promise<Detection | null> {
  const { data, error } = await supabase
    .from('detections')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data ? toDetectionModel(data) : null;
}

/**
 * Get detection with related camera and POI data
 */
export async function getDetectionWithDetails(id: string): Promise<DetectionWithDetails | null> {
  const { data, error } = await supabase
    .from('detections')
    .select(`
      *,
      cameras (*),
      watchlist (*)
    `)
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data ? toDetectionWithDetails(data) : null;
}

/**
 * Get detections with related data
 */
export async function getDetectionsWithDetails(filters?: DetectionFilters): Promise<DetectionWithDetails[]> {
  let query = supabase
    .from('detections')
    .select(`
      *,
      cameras (*),
      watchlist (*)
    `)
    .order('detected_at', { ascending: false });

  if (filters?.poiId) {
    query = query.eq('poi_id', filters.poiId);
  }
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
  return (data || []).map(toDetectionWithDetails);
}

/**
 * Link a detection to a case
 */
export async function linkDetectionToCase(detectionId: string, caseId: string): Promise<void> {
  const { error } = await supabase
    .from('detections')
    .update({ 
      metadata: supabase.rpc('jsonb_set_key', {
        target: 'metadata',
        key: 'linkedCaseId',
        value: caseId
      })
    })
    .eq('id', detectionId);

  // Fallback: fetch, update metadata, and save
  if (error) {
    const detection = await getDetection(detectionId);
    if (!detection) throw new Error('Detection not found');

    const { error: updateError } = await supabase
      .from('detections')
      .update({
        metadata: { ...detection.metadata, linkedCaseId: caseId }
      })
      .eq('id', detectionId);

    if (updateError) throw updateError;
  }
}

/**
 * Get detection count for a camera
 */
export async function getDetectionCountByCamera(cameraId: string): Promise<number> {
  const { count, error } = await supabase
    .from('detections')
    .select('*', { count: 'exact', head: true })
    .eq('camera_id', cameraId);

  if (error) throw error;
  return count || 0;
}

/**
 * Get recent detections (last 24 hours)
 */
export async function getRecentDetections(limit: number = 50): Promise<Detection[]> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const { data, error } = await supabase
    .from('detections')
    .select('*')
    .gte('detected_at', yesterday.toISOString())
    .order('detected_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []).map(toDetectionModel);
}
