/**
 * Property Tests for DetectionService
 * 
 * Tests detection processing, storage, and filtering operations.
 */

import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import * as fc from 'fast-check';
import { supabase } from './supabase';
import * as detectionService from './detectionService';
import * as cameraService from './cameraService';
import * as watchlistService from './watchlistService';
import { POIPriority, CameraStatus } from '../types';

// Destructure after import to ensure modules are fully loaded
const {
  getDetections,
  getDetection,
  getRecentDetections
} = detectionService;
const { createCamera, deleteCamera } = cameraService;
const { addPOI, removePOI } = watchlistService;

// Track created resources for cleanup
const createdCameraIds: string[] = [];
const createdPOIIds: string[] = [];
const createdDetectionIds: string[] = [];

const TEST_USER_ID = 'test-user-id';

// Helper to create test detection directly in DB
async function createTestDetection(cameraId: string, poiId: string, confidence: number) {
  const { data, error } = await supabase
    .from('detections')
    .insert({
      camera_id: cameraId,
      poi_id: poiId,
      snapshot_url: 'https://example.com/snapshot.jpg',
      confidence,
      bounding_box: null,
      detected_at: new Date().toISOString(),
      metadata: {}
    })
    .select()
    .single();

  if (error) throw error;
  createdDetectionIds.push(data.id);
  return data;
}

describe('DetectionService Property Tests', () => {
  afterEach(async () => {
    // Clean up in reverse order of dependencies
    for (const id of createdDetectionIds) {
      try {
        await supabase.from('detections').delete().eq('id', id);
      } catch { /* ignore */ }
    }
    createdDetectionIds.length = 0;

    for (const id of createdPOIIds) {
      try {
        await supabase.from('watchlist').delete().eq('id', id);
      } catch { /* ignore */ }
    }
    createdPOIIds.length = 0;

    for (const id of createdCameraIds) {
      try {
        await supabase.from('cameras').delete().eq('id', id);
      } catch { /* ignore */ }
    }
    createdCameraIds.length = 0;
  });

  /**
   * Property 6: Detection history filtering
   * Detections should be filterable by POI, camera, date range, and confidence.
   * Validates: Requirements 7.2
   */
  describe('Property 6: Detection history filtering', () => {
    it('should filter detections by confidence threshold', async () => {
      // Create test camera and POI
      const camera = await createCamera({
        name: 'Test Camera',
        streamUrl: 'https://example.com/stream',
        lat: 0,
        lng: 0
      });
      createdCameraIds.push(camera.id);

      const poi = await addPOI({
        faceToken: 'test-token-filter',
        name: 'Test POI'
      }, TEST_USER_ID);
      createdPOIIds.push(poi.id);

      // Create detections with varying confidence
      await createTestDetection(camera.id, poi.id, 0.95);
      await createTestDetection(camera.id, poi.id, 0.75);
      await createTestDetection(camera.id, poi.id, 0.50);

      // Filter by minimum confidence
      const highConfidence = await getDetections({ minConfidence: 0.90 });
      const mediumConfidence = await getDetections({ minConfidence: 0.70 });
      const allDetections = await getDetections({ minConfidence: 0.40 });

      expect(highConfidence.length).toBeGreaterThanOrEqual(1);
      expect(mediumConfidence.length).toBeGreaterThanOrEqual(2);
      expect(allDetections.length).toBeGreaterThanOrEqual(3);

      // All returned detections should meet the threshold
      highConfidence.forEach(d => expect(d.confidence).toBeGreaterThanOrEqual(0.90));
      mediumConfidence.forEach(d => expect(d.confidence).toBeGreaterThanOrEqual(0.70));
    });

    it('should filter detections by camera', async () => {
      // Create two cameras
      const camera1 = await createCamera({
        name: 'Camera 1',
        streamUrl: 'https://example.com/stream1',
        lat: 0,
        lng: 0
      });
      createdCameraIds.push(camera1.id);

      const camera2 = await createCamera({
        name: 'Camera 2',
        streamUrl: 'https://example.com/stream2',
        lat: 1,
        lng: 1
      });
      createdCameraIds.push(camera2.id);

      const poi = await addPOI({
        faceToken: 'test-token-camera-filter',
        name: 'Test POI'
      }, TEST_USER_ID);
      createdPOIIds.push(poi.id);

      // Create detections on different cameras
      await createTestDetection(camera1.id, poi.id, 0.90);
      await createTestDetection(camera1.id, poi.id, 0.85);
      await createTestDetection(camera2.id, poi.id, 0.80);

      // Filter by camera
      const camera1Detections = await getDetections({ cameraId: camera1.id });
      const camera2Detections = await getDetections({ cameraId: camera2.id });

      expect(camera1Detections.length).toBe(2);
      expect(camera2Detections.length).toBe(1);

      camera1Detections.forEach(d => expect(d.cameraId).toBe(camera1.id));
      camera2Detections.forEach(d => expect(d.cameraId).toBe(camera2.id));
    });

    it('should filter detections by POI', async () => {
      const camera = await createCamera({
        name: 'Test Camera',
        streamUrl: 'https://example.com/stream',
        lat: 0,
        lng: 0
      });
      createdCameraIds.push(camera.id);

      // Create two POIs
      const poi1 = await addPOI({
        faceToken: 'test-token-poi1',
        name: 'POI 1'
      }, TEST_USER_ID);
      createdPOIIds.push(poi1.id);

      const poi2 = await addPOI({
        faceToken: 'test-token-poi2',
        name: 'POI 2'
      }, TEST_USER_ID);
      createdPOIIds.push(poi2.id);

      // Create detections for different POIs
      await createTestDetection(camera.id, poi1.id, 0.90);
      await createTestDetection(camera.id, poi2.id, 0.85);
      await createTestDetection(camera.id, poi2.id, 0.80);

      // Filter by POI
      const poi1Detections = await getDetections({ poiId: poi1.id });
      const poi2Detections = await getDetections({ poiId: poi2.id });

      expect(poi1Detections.length).toBe(1);
      expect(poi2Detections.length).toBe(2);

      poi1Detections.forEach(d => expect(d.poiId).toBe(poi1.id));
      poi2Detections.forEach(d => expect(d.poiId).toBe(poi2.id));
    });
  });

  /**
   * Property: Detection round-trip consistency
   */
  describe('Detection round-trip consistency', () => {
    it('should preserve detection data through create and fetch', async () => {
      const camera = await createCamera({
        name: 'Test Camera',
        streamUrl: 'https://example.com/stream',
        lat: 0,
        lng: 0
      });
      createdCameraIds.push(camera.id);

      const poi = await addPOI({
        faceToken: 'test-token-roundtrip',
        name: 'Test POI'
      }, TEST_USER_ID);
      createdPOIIds.push(poi.id);

      const detection = await createTestDetection(camera.id, poi.id, 0.92);
      
      const fetched = await getDetection(detection.id);
      
      expect(fetched).not.toBeNull();
      expect(fetched!.cameraId).toBe(camera.id);
      expect(fetched!.poiId).toBe(poi.id);
      expect(fetched!.confidence).toBe(0.92);
    });
  });
});
