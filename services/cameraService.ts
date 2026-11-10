/**
 * Minimal Camera Service for testing
 */

import { supabase } from './supabase';
import { Camera, CameraStatus, CreateCameraInput, UpdateCameraInput } from '../types';

// Convert snake_case DB row to camelCase Camera
function toCameraModel(row: any): Camera {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    streamUrl: row.stream_url,
    coordinates: { lat: row.lat, lng: row.lng },
    status: row.status as CameraStatus,
    lastOnline: row.last_online,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function getCameras(): Promise<Camera[]> {
  const { data, error } = await supabase
    .from('cameras')
    .select('*')
    .order('name', { ascending: true });

  if (error) throw error;
  return (data || []).map(toCameraModel);
}

export async function getCamera(id: string): Promise<Camera | null> {
  const { data, error } = await supabase
    .from('cameras')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data ? toCameraModel(data) : null;
}

export async function createCamera(input: CreateCameraInput): Promise<Camera> {
  const { data, error } = await supabase
    .from('cameras')
    .insert({
      name: input.name,
      description: input.description || '',
      stream_url: input.streamUrl,
      lat: input.lat,
      lng: input.lng,
      status: CameraStatus.OFFLINE,
      last_online: null
    })
    .select()
    .single();

  if (error) throw error;
  return toCameraModel(data);
}

export async function updateCamera(id: string, input: UpdateCameraInput): Promise<Camera> {
  const updates: Record<string, any> = {};
  
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;
  if (input.streamUrl !== undefined) updates.stream_url = input.streamUrl;
  if (input.lat !== undefined) updates.lat = input.lat;
  if (input.lng !== undefined) updates.lng = input.lng;
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('cameras')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toCameraModel(data);
}

export async function deleteCamera(id: string): Promise<void> {
  const { error } = await supabase
    .from('cameras')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function updateCameraStatus(id: string, status: CameraStatus): Promise<Camera> {
  const updates: Record<string, any> = {
    status,
    updated_at: new Date().toISOString()
  };

  if (status === CameraStatus.ONLINE || status === CameraStatus.RECORDING) {
    updates.last_online = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('cameras')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toCameraModel(data);
}

export async function validateStreamUrl(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:', 'rtsp:', 'rtmp:'].includes(parsed.protocol)) {
      return false;
    }

    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      try {
        const response = await fetch(url, {
          method: 'HEAD',
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response.ok;
      } catch {
        clearTimeout(timeoutId);
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}
