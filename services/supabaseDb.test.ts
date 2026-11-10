import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { supabaseDb } from './supabaseDb';
import { supabase } from './supabase';
import { User, UserRole, Suspect, AuditLog } from '../types';

/**
 * Property tests for Supabase Database Service - User Operations
 * 
 * These tests validate correctness properties against the real Supabase database.
 * Each test cleans up after itself to maintain test isolation.
 */

// Helper to generate unique test IDs
const testPrefix = () => `test_${Date.now()}_${Math.random().toString(36).substring(7)}`;

// Helper to clean up test users
async function cleanupTestUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await supabase.from('users').delete().in('id', userIds);
}

describe('User Operations Property Tests', () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    // Clean up all test users created during tests
    await cleanupTestUsers(createdUserIds);
    createdUserIds.length = 0;
  });

  /**
   * **Feature: supabase-migration, Property 1: User Round-Trip Consistency**
   * **Validates: Requirements 1.2, 1.4**
   * 
   * For any valid User object, adding it to the database and then retrieving
   * all users should return a collection containing that user with all fields intact.
   */
  it('Property 1: User Round-Trip Consistency', async () => {
    const userArbitrary = fc.record({
      id: fc.string({ minLength: 1, maxLength: 50 }).map(s => `${testPrefix()}_${s.replace(/[^a-zA-Z0-9_]/g, '')}`),
      username: fc.string({ minLength: 1, maxLength: 50 }).map(s => `${testPrefix()}_${s.replace(/[^a-zA-Z0-9_]/g, '')}`),
      role: fc.constantFrom(UserRole.CHIEF_COMMANDER, UserRole.OFFICER),
      createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map(d => d.toISOString())
    });

    await fc.assert(
      fc.asyncProperty(userArbitrary, async (user: User) => {
        createdUserIds.push(user.id);
        
        // Add user to database
        await supabaseDb.addUser(user);
        
        // Retrieve all users
        const users = await supabaseDb.getUsers();
        
        // Find the user we just added
        const foundUser = users.find(u => u.id === user.id);
        
        // Verify user exists and all fields match
        expect(foundUser).toBeDefined();
        expect(foundUser?.id).toBe(user.id);
        expect(foundUser?.username).toBe(user.username);
        expect(foundUser?.role).toBe(user.role);
        // Compare timestamps (may have slight precision differences)
        expect(new Date(foundUser?.createdAt || '').getTime()).toBeCloseTo(
          new Date(user.createdAt).getTime(),
          -3 // Within 1 second
        );
        
        return true;
      }),
      { numRuns: 5 } // Reduced runs for database tests
    );
  }, 30000); // 30 second timeout for database operations


  /**
   * **Feature: supabase-migration, Property 2: Bulk Officer Creation Count**
   * **Validates: Requirements 1.3**
   * 
   * For any positive integer N, calling bulkCreateOfficers(N) should increase
   * the total user count by exactly N, and all new users should have role 'OFFICER'.
   */
  it('Property 2: Bulk Officer Creation Count', async () => {
    const countArbitrary = fc.integer({ min: 1, max: 5 }); // Small counts for DB tests

    await fc.assert(
      fc.asyncProperty(countArbitrary, async (count: number) => {
        // Get initial user count
        const initialUsers = await supabaseDb.getUsers();
        const initialCount = initialUsers.length;
        
        // Create bulk officers
        await supabaseDb.bulkCreateOfficers(count);
        
        // Get updated user list
        const updatedUsers = await supabaseDb.getUsers();
        const updatedCount = updatedUsers.length;
        
        // Find newly created users (those not in initial list)
        const initialIds = new Set(initialUsers.map(u => u.id));
        const newUsers = updatedUsers.filter(u => !initialIds.has(u.id));
        
        // Track for cleanup
        newUsers.forEach(u => createdUserIds.push(u.id));
        
        // Verify count increased by exactly N
        expect(updatedCount).toBe(initialCount + count);
        
        // Verify all new users have OFFICER role
        for (const user of newUsers) {
          expect(user.role).toBe(UserRole.OFFICER);
        }
        
        // Verify exactly N new users were created
        expect(newUsers.length).toBe(count);
        
        return true;
      }),
      { numRuns: 3 } // Reduced runs for database tests
    );
  }, 30000); // 30 second timeout for database operations
});


// Helper to clean up test suspects
async function cleanupTestSuspects(faceTokens: string[]): Promise<void> {
  if (faceTokens.length === 0) return;
  await supabase.from('suspects').delete().in('face_token', faceTokens);
}

describe('Suspect Operations Property Tests', () => {
  const createdFaceTokens: string[] = [];

  afterEach(async () => {
    await cleanupTestSuspects(createdFaceTokens);
    createdFaceTokens.length = 0;
  });

  // Arbitrary for generating valid suspects
  const suspectArbitrary = fc.record({
    faceToken: fc.string({ minLength: 1, maxLength: 50 }).map(s => `test_ft_${Date.now()}_${s.replace(/[^a-zA-Z0-9_]/g, '')}`),
    name: fc.string({ minLength: 1, maxLength: 100 }).map(s => s.replace(/[^\w\s]/g, '') || 'TestName'),
    crime: fc.string({ minLength: 1, maxLength: 100 }).map(s => s.replace(/[^\w\s]/g, '') || 'TestCrime'),
    nin: fc.string({ minLength: 1, maxLength: 50 }).map(s => `NIN-${s.replace(/[^a-zA-Z0-9]/g, '')}`),
    location: fc.string({ minLength: 1, maxLength: 100 }).map(s => s.replace(/[^\w\s,]/g, '') || 'TestLocation'),
    imageUrl: fc.webUrl(),
    sourceUrl: fc.string({ minLength: 1, maxLength: 100 }).map(s => s.replace(/[^\w\s]/g, '') || 'test_source'),
    status: fc.constantFrom('WANTED', 'IN_CUSTODY', 'CLEARED', 'DECEASED') as fc.Arbitrary<Suspect['status']>,
    coordinates: fc.option(fc.record({
      lat: fc.double({ min: -90, max: 90, noNaN: true }),
      lng: fc.double({ min: -180, max: 180, noNaN: true })
    }), { nil: undefined })
  });

  /**
   * **Feature: supabase-migration, Property 3: Suspect Round-Trip Consistency**
   * **Validates: Requirements 2.2, 2.5**
   * 
   * For any valid Suspect object (including optional coordinates), adding it to
   * the database and then retrieving all suspects should return a collection
   * containing that suspect with all fields intact.
   */
  it('Property 3: Suspect Round-Trip Consistency', async () => {
    await fc.assert(
      fc.asyncProperty(suspectArbitrary, async (suspect: Suspect) => {
        createdFaceTokens.push(suspect.faceToken);
        
        // Add suspect to database
        await supabaseDb.addSuspect(suspect);
        
        // Retrieve all suspects
        const suspects = await supabaseDb.getSuspects();
        
        // Find the suspect we just added
        const foundSuspect = suspects.find(s => s.faceToken === suspect.faceToken);
        
        // Verify suspect exists and required fields match
        expect(foundSuspect).toBeDefined();
        expect(foundSuspect?.faceToken).toBe(suspect.faceToken);
        expect(foundSuspect?.name).toBe(suspect.name);
        expect(foundSuspect?.crime).toBe(suspect.crime);
        expect(foundSuspect?.nin).toBe(suspect.nin);
        expect(foundSuspect?.location).toBe(suspect.location);
        expect(foundSuspect?.imageUrl).toBe(suspect.imageUrl);
        expect(foundSuspect?.sourceUrl).toBe(suspect.sourceUrl);
        expect(foundSuspect?.status).toBe(suspect.status);
        
        // Verify coordinates if present
        if (suspect.coordinates) {
          expect(foundSuspect?.coordinates).toBeDefined();
          expect(foundSuspect?.coordinates?.lat).toBeCloseTo(suspect.coordinates.lat, 5);
          expect(foundSuspect?.coordinates?.lng).toBeCloseTo(suspect.coordinates.lng, 5);
        }
        
        return true;
      }),
      { numRuns: 5 }
    );
  }, 30000);


  /**
   * **Feature: supabase-migration, Property 4: Suspect Update Persistence**
   * **Validates: Requirements 2.3**
   * 
   * For any existing suspect and any valid field updates, calling updateSuspect
   * should result in the suspect having the updated values when retrieved.
   */
  it('Property 4: Suspect Update Persistence', async () => {
    const updateArbitrary = fc.record({
      newName: fc.string({ minLength: 1, maxLength: 100 }).map(s => s.replace(/[^\w\s]/g, '') || 'UpdatedName'),
      newCrime: fc.string({ minLength: 1, maxLength: 100 }).map(s => s.replace(/[^\w\s]/g, '') || 'UpdatedCrime'),
      newLocation: fc.string({ minLength: 1, maxLength: 100 }).map(s => s.replace(/[^\w\s,]/g, '') || 'UpdatedLocation')
    });

    await fc.assert(
      fc.asyncProperty(suspectArbitrary, updateArbitrary, async (suspect, updates) => {
        createdFaceTokens.push(suspect.faceToken);
        
        // Add initial suspect
        await supabaseDb.addSuspect(suspect);
        
        // Create updated suspect
        const updatedSuspect: Suspect = {
          ...suspect,
          name: updates.newName,
          crime: updates.newCrime,
          location: updates.newLocation
        };
        
        // Update suspect
        await supabaseDb.updateSuspect(updatedSuspect);
        
        // Retrieve and verify
        const suspects = await supabaseDb.getSuspects();
        const foundSuspect = suspects.find(s => s.faceToken === suspect.faceToken);
        
        expect(foundSuspect).toBeDefined();
        expect(foundSuspect?.name).toBe(updates.newName);
        expect(foundSuspect?.crime).toBe(updates.newCrime);
        expect(foundSuspect?.location).toBe(updates.newLocation);
        // Original fields should be preserved
        expect(foundSuspect?.faceToken).toBe(suspect.faceToken);
        expect(foundSuspect?.nin).toBe(suspect.nin);
        
        return true;
      }),
      { numRuns: 3 }
    );
  }, 30000);

  /**
   * **Feature: supabase-migration, Property 5: Status Update Isolation**
   * **Validates: Requirements 2.4**
   * 
   * For any existing suspect and any valid status value, calling updateSuspectStatus
   * should change only the status field while preserving all other fields.
   */
  it('Property 5: Status Update Isolation', async () => {
    const newStatusArbitrary = fc.constantFrom('WANTED', 'IN_CUSTODY', 'CLEARED', 'DECEASED') as fc.Arbitrary<Suspect['status']>;

    await fc.assert(
      fc.asyncProperty(suspectArbitrary, newStatusArbitrary, async (suspect, newStatus) => {
        createdFaceTokens.push(suspect.faceToken);
        
        // Add initial suspect
        await supabaseDb.addSuspect(suspect);
        
        // Update only status
        await supabaseDb.updateSuspectStatus(suspect.faceToken, newStatus);
        
        // Retrieve and verify
        const suspects = await supabaseDb.getSuspects();
        const foundSuspect = suspects.find(s => s.faceToken === suspect.faceToken);
        
        // Status should be updated
        expect(foundSuspect?.status).toBe(newStatus);
        
        // All other fields should be preserved
        expect(foundSuspect?.faceToken).toBe(suspect.faceToken);
        expect(foundSuspect?.name).toBe(suspect.name);
        expect(foundSuspect?.crime).toBe(suspect.crime);
        expect(foundSuspect?.nin).toBe(suspect.nin);
        expect(foundSuspect?.location).toBe(suspect.location);
        expect(foundSuspect?.imageUrl).toBe(suspect.imageUrl);
        expect(foundSuspect?.sourceUrl).toBe(suspect.sourceUrl);
        
        return true;
      }),
      { numRuns: 3 }
    );
  }, 30000);
});


// Helper to clean up test audit logs
async function cleanupTestAuditLogs(logIds: string[]): Promise<void> {
  if (logIds.length === 0) return;
  await supabase.from('audit_logs').delete().in('log_id', logIds);
}

describe('Audit Log Operations Property Tests', () => {
  const createdLogIds: string[] = [];
  const createdUserIds: string[] = [];
  let testOfficerId: string;

  // Create a test officer before running audit log tests (for foreign key constraint)
  beforeEach(async () => {
    testOfficerId = `test_officer_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    await supabase.from('users').insert({
      id: testOfficerId,
      username: `TestOfficer_${Date.now()}`,
      role: 'OFFICER',
      created_at: new Date().toISOString()
    });
    createdUserIds.push(testOfficerId);
  });

  afterEach(async () => {
    await cleanupTestAuditLogs(createdLogIds);
    createdLogIds.length = 0;
    await supabase.from('users').delete().in('id', createdUserIds);
    createdUserIds.length = 0;
  });

  /**
   * **Feature: supabase-migration, Property 6: Audit Log Round-Trip Consistency**
   * **Validates: Requirements 3.1**
   * 
   * For any valid AuditLog object with a valid officer_id, logging it and then
   * retrieving audit logs should return a collection containing that log with
   * all fields intact.
   */
  it('Property 6: Audit Log Round-Trip Consistency', async () => {
    const auditLogArbitrary = fc.record({
      logId: fc.string({ minLength: 1, maxLength: 50 }).map(s => `test_log_${Date.now()}_${s.replace(/[^a-zA-Z0-9_]/g, '')}`),
      searchImagePath: fc.string({ minLength: 1, maxLength: 200 }).map(s => s.replace(/[^\w\s\/:.]/g, '') || '/test/path'),
      timestamp: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map(d => d.toISOString()),
      resultCount: fc.integer({ min: 0, max: 1000 }),
      searchType: fc.constantFrom('LOCAL', 'DEEP_WEB') as fc.Arbitrary<'LOCAL' | 'DEEP_WEB'>
    });

    await fc.assert(
      fc.asyncProperty(auditLogArbitrary, async (partialLog) => {
        const log = {
          ...partialLog,
          officerId: testOfficerId
        };
        createdLogIds.push(log.logId);
        
        // Log the search
        await supabaseDb.logSearch(log);
        
        // Retrieve all audit logs
        const logs = await supabaseDb.getAuditLogs();
        
        // Find the log we just added
        const foundLog = logs.find(l => l.logId === log.logId);
        
        // Verify log exists and all fields match
        expect(foundLog).toBeDefined();
        expect(foundLog?.logId).toBe(log.logId);
        expect(foundLog?.officerId).toBe(log.officerId);
        expect(foundLog?.searchImagePath).toBe(log.searchImagePath);
        expect(foundLog?.resultCount).toBe(log.resultCount);
        expect(foundLog?.searchType).toBe(log.searchType);
        
        return true;
      }),
      { numRuns: 5 }
    );
  }, 30000);

  /**
   * **Feature: supabase-migration, Property 7: Audit Log Ordering**
   * **Validates: Requirements 3.2**
   * 
   * For any set of audit logs with distinct timestamps, getAuditLogs should
   * return them in descending timestamp order (newest first).
   */
  it('Property 7: Audit Log Ordering', async () => {
    // Create multiple logs with distinct timestamps
    const timestamps = [
      new Date('2024-01-01T10:00:00Z'),
      new Date('2024-01-01T12:00:00Z'),
      new Date('2024-01-01T11:00:00Z')
    ];
    
    const logs = timestamps.map((ts, i) => ({
      logId: `test_order_log_${Date.now()}_${i}`,
      officerId: testOfficerId,
      searchImagePath: `/test/path/${i}`,
      timestamp: ts.toISOString(),
      resultCount: i,
      searchType: 'LOCAL' as const
    }));
    
    // Track for cleanup
    logs.forEach(l => createdLogIds.push(l.logId));
    
    // Insert logs in random order
    for (const log of logs) {
      await supabaseDb.logSearch(log);
    }
    
    // Retrieve logs
    const retrievedLogs = await supabaseDb.getAuditLogs();
    
    // Filter to only our test logs
    const testLogs = retrievedLogs.filter(l => 
      logs.some(orig => orig.logId === l.logId)
    );
    
    // Verify ordering - should be newest first
    for (let i = 0; i < testLogs.length - 1; i++) {
      const currentTs = new Date(testLogs[i].timestamp).getTime();
      const nextTs = new Date(testLogs[i + 1].timestamp).getTime();
      expect(currentTs).toBeGreaterThanOrEqual(nextTs);
    }
  }, 30000);
});
