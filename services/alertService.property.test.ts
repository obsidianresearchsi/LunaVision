/**
 * Property Tests for AlertService
 * 
 * Tests alert management including acknowledgment and creation from detections.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { supabase } from './supabase';
import * as alertService from './alertService';
import * as cameraService from './cameraService';
import * as watchlistService from './watchlistService';
import { AlertStatus, Detection } from '../types';

// Destructure after import to ensure modules are fully loaded
const {
  getAlerts,
  getAlert,
  acknowledgeAlert,
  createAlertFromDetection,
  getUnreadCount,
  markAlertAsRead
} = alertService;
const { createCamera } = cameraService;
const { addPOI } = watchlistService;

// Track created resources for cleanup
const createdCameraIds: string[] = [];
const createdPOIIds: string[] = [];
const createdDetectionIds: string[] = [];
const createdAlertIds: string[] = [];

const TEST_USER_ID = 'test-user-id';
const TEST_OFFICER_ID = 'test-officer-id';

// Helper to create test detection directly in DB
async function createTestDetection(cameraId: string, poiId: string, confidence: number): Promise<Detection> {
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
  
  return {
    id: data.id,
    cameraId: data.camera_id,
    poiId: data.poi_id,
    snapshotUrl: data.snapshot_url,
    confidence: data.confidence,
    boundingBox: data.bounding_box,
    detectedAt: data.detected_at,
    metadata: data.metadata || {}
  };
}

// Helper to create test alert directly in DB
async function createTestAlert(detectionId: string, poiId: string, cameraId: string) {
  const { data, error } = await supabase
    .from('surveillance_alerts')
    .insert({
      detection_id: detectionId,
      poi_id: poiId,
      camera_id: cameraId,
      status: AlertStatus.UNREAD,
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) throw error;
  createdAlertIds.push(data.id);
  return data;
}

describe('AlertService Property Tests', () => {
  afterEach(async () => {
    // Clean up in reverse order of dependencies
    for (const id of createdAlertIds) {
      try {
        await supabase.from('surveillance_alerts').delete().eq('id', id);
      } catch { /* ignore */ }
    }
    createdAlertIds.length = 0;

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
   * Property 5: Alert acknowledgment is logged
   * Acknowledging an alert should record the officer ID and timestamp.
   * Validates: Requirements 6.5
   */
  describe('Property 5: Alert acknowledgment is logged', () => {
    it('should record officer ID and timestamp when acknowledging alert', async () => {
      // Create test camera and POI
      const camera = await createCamera({
        name: 'Test Camera',
        streamUrl: 'https://example.com/stream',
        lat: 0,
        lng: 0
      });
      createdCameraIds.push(camera.id);

      const poi = await addPOI({
        faceToken: 'test-token-ack',
        name: 'Test POI'
      }, TEST_USER_ID);
      createdPOIIds.push(poi.id);

      // Create detection and alert
      const detection = await createTestDetection(camera.id, poi.id, 0.95);
      const alert = await createTestAlert(detection.id, poi.id, camera.id);

      // Verify initial state
      const initialAlert = await getAlert(alert.id);
      expect(initialAlert).not.toBeNull();
      expect(initialAlert!.status).toBe(AlertStatus.UNREAD);
      expect(initialAlert!.acknowledgedBy).toBeUndefined();
      expect(initialAlert!.acknowledgedAt).toBeUndefined();

      // Acknowledge the alert
      const beforeAck = new Date();
      const acknowledged = await acknowledgeAlert(alert.id, TEST_OFFICER_ID);
      const afterAck = new Date();

      // Verify acknowledgment data
      expect(acknowledged.status).toBe(AlertStatus.ACKNOWLEDGED);
      expect(acknowledged.acknowledgedBy).toBe(TEST_OFFICER_ID);
      expect(acknowledged.acknowledgedAt).toBeDefined();

      // Verify timestamp is within expected range
      const ackTime = new Date(acknowledged.acknowledgedAt!);
      expect(ackTime.getTime()).toBeGreaterThanOrEqual(beforeAck.getTime() - 1000);
      expect(ackTime.getTime()).toBeLessThanOrEqual(afterAck.getTime() + 1000);

      // Verify persistence
      const fetched = await getAlert(alert.id);
      expect(fetched!.status).toBe(AlertStatus.ACKNOWLEDGED);
      expect(fetched!.acknowledgedBy).toBe(TEST_OFFICER_ID);
    });
  });

  /**
   * Property 4: Detection creates alert
   * High-confidence detections should create alerts.
   * Validates: Requirements 6.1, 8.3
   */
  describe('Property 4: Detection creates alert', () => {
    it('should create alert when detection confidence exceeds threshold', async () => {
      const camera = await createCamera({
        name: 'Test Camera',
        streamUrl: 'https://example.com/stream',
        lat: 0,
        lng: 0
      });
      createdCameraIds.push(camera.id);

      const poi = await addPOI({
        faceToken: 'test-token-alert-create',
        name: 'Test POI'
      }, TEST_USER_ID);
      createdPOIIds.push(poi.id);

      // Create high-confidence detection
      const highConfDetection = await createTestDetection(camera.id, poi.id, 0.95);
      
      // Create alert from detection
      const alert = await createAlertFromDetection(highConfDetection, 0.8);
      if (alert) createdAlertIds.push(alert.id);

      expect(alert).not.toBeNull();
      expect(alert!.detectionId).toBe(highConfDetection.id);
      expect(alert!.poiId).toBe(poi.id);
      expect(alert!.cameraId).toBe(camera.id);
      expect(alert!.status).toBe(AlertStatus.UNREAD);
    });

    it('should not create alert when detection confidence is below threshold', async () => {
      const camera = await createCamera({
        name: 'Test Camera',
        streamUrl: 'https://example.com/stream',
        lat: 0,
        lng: 0
      });
      createdCameraIds.push(camera.id);

      const poi = await addPOI({
        faceToken: 'test-token-low-conf',
        name: 'Test POI'
      }, TEST_USER_ID);
      createdPOIIds.push(poi.id);

      // Create low-confidence detection
      const lowConfDetection = await createTestDetection(camera.id, poi.id, 0.5);
      
      // Try to create alert from detection
      const alert = await createAlertFromDetection(lowConfDetection, 0.8);

      expect(alert).toBeNull();
    });
  });

  /**
   * Property: Alert status transitions
   */
  describe('Alert status transitions', () => {
    it('should transition from UNREAD to READ', async () => {
      const camera = await createCamera({
        name: 'Test Camera',
        streamUrl: 'https://example.com/stream',
        lat: 0,
        lng: 0
      });
      createdCameraIds.push(camera.id);

      const poi = await addPOI({
        faceToken: 'test-token-status',
        name: 'Test POI'
      }, TEST_USER_ID);
      createdPOIIds.push(poi.id);

      const detection = await createTestDetection(camera.id, poi.id, 0.90);
      const alert = await createTestAlert(detection.id, poi.id, camera.id);

      // Mark as read
      const readAlert = await markAlertAsRead(alert.id);

      expect(readAlert.status).toBe(AlertStatus.READ);
    });
  });

  /**
   * Property: Unread count accuracy
   */
  describe('Unread count accuracy', () => {
    it('should accurately count unread alerts', async () => {
      const camera = await createCamera({
        name: 'Test Camera',
        streamUrl: 'https://example.com/stream',
        lat: 0,
        lng: 0
      });
      createdCameraIds.push(camera.id);

      const poi = await addPOI({
        faceToken: 'test-token-count',
        name: 'Test POI'
      }, TEST_USER_ID);
      createdPOIIds.push(poi.id);

      const initialCount = await getUnreadCount();

      // Create 3 unread alerts
      for (let i = 0; i < 3; i++) {
        const detection = await createTestDetection(camera.id, poi.id, 0.90);
        await createTestAlert(detection.id, poi.id, camera.id);
      }

      const newCount = await getUnreadCount();
      expect(newCount).toBe(initialCount + 3);
    });
  });
});
