/**
 * Property Tests for WatchlistService
 * 
 * Tests POI management operations including registration,
 * updates, soft deletion, and detection history.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { supabase } from './supabase';
import {
  getPOIs,
  getPOI,
  addPOI,
  updatePOI,
  removePOI,
  getDetectionHistory
} from './watchlistService';
import { POIPriority, AddPOIInput } from '../types';

// Track created POIs for cleanup
const createdPOIIds: string[] = [];

// Helper to generate valid POI input
const poiInputArb = fc.record({
  faceToken: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
  imageUrl: fc.option(fc.webUrl(), { nil: undefined }),
  priority: fc.constantFrom(POIPriority.CRITICAL, POIPriority.HIGH, POIPriority.MEDIUM, POIPriority.LOW),
  notes: fc.option(fc.string({ maxLength: 500 }), { nil: undefined })
});

// Test user ID for created_by field
const TEST_USER_ID = 'test-user-id';

describe('WatchlistService Property Tests', () => {
  afterEach(async () => {
    // Clean up created POIs
    for (const id of createdPOIIds) {
      try {
        await supabase.from('watchlist').delete().eq('id', id);
      } catch {
        // Ignore cleanup errors
      }
    }
    createdPOIIds.length = 0;
  });

  /**
   * Property 3: Watchlist POI registration
   * POIs should be registered with all required fields and correct defaults.
   * Validates: Requirements 4.2, 4.3
   */
  describe('Property 3: Watchlist POI registration', () => {
    it('should register POI with all required fields', async () => {
      await fc.assert(
        fc.asyncProperty(poiInputArb, async (input) => {
          const poi = await addPOI(input, TEST_USER_ID);
          createdPOIIds.push(poi.id);

          // Verify all fields are stored correctly
          expect(poi.faceToken).toBe(input.faceToken);
          expect(poi.name).toBe(input.name);
          expect(poi.priority).toBe(input.priority);
          expect(poi.isActive).toBe(true);
          expect(poi.createdBy).toBe(TEST_USER_ID);
          
          // Optional fields
          if (input.imageUrl) {
            expect(poi.imageUrl).toBe(input.imageUrl);
          }
          if (input.notes) {
            expect(poi.notes).toBe(input.notes);
          }

          // Verify round-trip
          const fetched = await getPOI(poi.id);
          expect(fetched).not.toBeNull();
          expect(fetched!.faceToken).toBe(input.faceToken);
          expect(fetched!.name).toBe(input.name);
        }),
        { numRuns: 5 }
      );
    });

    it('should default priority to MEDIUM when not specified', async () => {
      const input: AddPOIInput = {
        faceToken: 'test-token-default-priority',
        name: 'Test POI'
      };

      const poi = await addPOI(input, TEST_USER_ID);
      createdPOIIds.push(poi.id);

      expect(poi.priority).toBe(POIPriority.MEDIUM);
    });
  });


  /**
   * Property 8: Watchlist removal stops monitoring
   * Removing a POI should set is_active to false (soft delete).
   * Validates: Requirements 4.4
   */
  describe('Property 8: Watchlist removal stops monitoring', () => {
    it('should soft delete POI by setting is_active to false', async () => {
      await fc.assert(
        fc.asyncProperty(poiInputArb, async (input) => {
          // Create a POI
          const poi = await addPOI(input, TEST_USER_ID);
          createdPOIIds.push(poi.id);

          // Verify it's active
          expect(poi.isActive).toBe(true);

          // Remove the POI
          const removed = await removePOI(poi.id);

          // Verify soft delete
          expect(removed.isActive).toBe(false);
          expect(removed.id).toBe(poi.id);
          expect(removed.faceToken).toBe(poi.faceToken);

          // POI should still exist in database
          const fetched = await getPOI(poi.id);
          expect(fetched).not.toBeNull();
          expect(fetched!.isActive).toBe(false);

          // But should not appear in active-only list
          const activePOIs = await getPOIs(true);
          const found = activePOIs.find(p => p.id === poi.id);
          expect(found).toBeUndefined();

          // Should appear in all POIs list
          const allPOIs = await getPOIs(false);
          const foundInAll = allPOIs.find(p => p.id === poi.id);
          expect(foundInAll).toBeDefined();
        }),
        { numRuns: 5 }
      );
    }, 30000); // Increase timeout for network operations
  });

  /**
   * Property: POI update persistence
   * Updates to POI fields should be persisted correctly.
   */
  describe('POI update persistence', () => {
    it('should persist POI updates', async () => {
      await fc.assert(
        fc.asyncProperty(
          poiInputArb,
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
            priority: fc.constantFrom(POIPriority.CRITICAL, POIPriority.HIGH, POIPriority.MEDIUM, POIPriority.LOW),
            notes: fc.string({ minLength: 1, maxLength: 500 }) // Ensure non-empty notes to avoid null/undefined mismatch
          }),
          async (input, updates) => {
            const poi = await addPOI(input, TEST_USER_ID);
            createdPOIIds.push(poi.id);

            const updated = await updatePOI(poi.id, updates);

            expect(updated.name).toBe(updates.name);
            expect(updated.priority).toBe(updates.priority);
            // Notes may be stored as null for empty strings, so compare with fallback
            expect(updated.notes || '').toBe(updates.notes || '');
            // Unchanged fields should remain
            expect(updated.faceToken).toBe(input.faceToken);
            expect(updated.isActive).toBe(true);
          }
        ),
        { numRuns: 5 }
      );
    }, 30000);
  });

  /**
   * Property: Detection history filtering
   * Detection history should be filterable by various criteria.
   */
  describe('Detection history retrieval', () => {
    it('should return empty array for POI with no detections', async () => {
      await fc.assert(
        fc.asyncProperty(poiInputArb, async (input) => {
          const poi = await addPOI(input, TEST_USER_ID);
          createdPOIIds.push(poi.id);

          const history = await getDetectionHistory(poi.id);
          
          expect(Array.isArray(history)).toBe(true);
          expect(history.length).toBe(0);
        }),
        { numRuns: 3 }
      );
    });
  });
});
