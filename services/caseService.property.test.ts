/**
 * Property-Based Tests for Case Management Service
 * 
 * These tests validate correctness properties against the real Supabase database.
 * Each test cleans up after itself to maintain test isolation.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { generateCaseNumber, caseService, CaseError } from './caseService';
import { supabase } from './supabase';
import { CaseStatus, CasePriority, ActivityType, CreateCaseInput, UserRole } from '../types';

// Helper to generate unique test IDs
const testPrefix = () => `test_${Date.now()}_${Math.random().toString(36).substring(7)}`;

// Helper to clean up test cases
async function cleanupTestCases(caseIds: string[]): Promise<void> {
  if (caseIds.length === 0) return;
  // Delete in order due to foreign key constraints
  await supabase.from('case_activities').delete().in('case_id', caseIds);
  await supabase.from('case_notes').delete().in('case_id', caseIds);
  await supabase.from('case_linked_subjects').delete().in('case_id', caseIds);
  await supabase.from('case_linked_searches').delete().in('case_id', caseIds);
  await supabase.from('cases').delete().in('id', caseIds);
}

// Helper to clean up test users
async function cleanupTestUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await supabase.from('users').delete().in('id', userIds);
}

describe('Case Number Generation Property Tests', () => {
  const createdCaseIds: string[] = [];

  afterEach(async () => {
    await cleanupTestCases(createdCaseIds);
    createdCaseIds.length = 0;
  });

  /**
   * **Feature: case-management-system, Property 1: Case number format and uniqueness**
   * **Validates: Requirements 1.2**
   * 
   * For any case creation with valid input, the generated case number SHALL match
   * the format "CASE-YYYYMMDD-XXXX" where YYYY is the year, MM is the month, DD is
   * the day, and XXXX is a unique 4-character alphanumeric sequence, AND no two
   * cases SHALL have the same case number.
   */
  it('Property 1: Case number format and uniqueness', async () => {
    const caseNumbers: string[] = [];
    const caseNumberRegex = /^CASE-\d{4}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])-[A-Z0-9]{4}$/;
    
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async () => {
        // Generate a case number
        const caseNumber = await generateCaseNumber();
        
        // Verify format matches CASE-YYYYMMDD-XXXX
        expect(caseNumber).toMatch(caseNumberRegex);
        
        // Verify the date portion is valid
        const datePart = caseNumber.substring(5, 13);
        const year = parseInt(datePart.substring(0, 4));
        const month = parseInt(datePart.substring(4, 6));
        const day = parseInt(datePart.substring(6, 8));
        
        const now = new Date();
        expect(year).toBe(now.getFullYear());
        expect(month).toBe(now.getMonth() + 1);
        expect(day).toBe(now.getDate());
        
        // Verify uniqueness - this case number should not have been generated before
        expect(caseNumbers).not.toContain(caseNumber);
        caseNumbers.push(caseNumber);
        
        return true;
      }),
      { numRuns: 10 }
    );
  }, 60000);
});


describe('Case Creation Property Tests', () => {
  const createdCaseIds: string[] = [];
  const createdUserIds: string[] = [];
  let testOfficerId: string;

  beforeEach(async () => {
    // Create a test officer for case creation
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
    await cleanupTestCases(createdCaseIds);
    createdCaseIds.length = 0;
    await cleanupTestUsers(createdUserIds);
    createdUserIds.length = 0;
  });

  // Arbitrary for generating valid case input
  // Must ensure non-whitespace content after sanitization
  const validCaseInputArbitrary = fc.record({
    title: fc.string({ minLength: 1, maxLength: 100 }).map(s => {
      const sanitized = s.replace(/[^\w\s]/g, '').trim();
      return sanitized.length > 0 ? sanitized : 'TestTitle';
    }),
    description: fc.string({ minLength: 1, maxLength: 500 }).map(s => {
      const sanitized = s.replace(/[^\w\s]/g, '').trim();
      return sanitized.length > 0 ? sanitized : 'TestDescription';
    }),
    priority: fc.constantFrom(CasePriority.LOW, CasePriority.MEDIUM, CasePriority.HIGH, CasePriority.CRITICAL)
  });

  /**
   * **Feature: case-management-system, Property 2: Case creation initializes correctly**
   * **Validates: Requirements 1.3, 1.4**
   * 
   * For any case creation, the resulting case SHALL have status set to OPEN,
   * owner_id set to the creating officer's ID, AND an activity log entry of type
   * CASE_CREATED SHALL be created with the correct timestamp and officer ID.
   */
  it('Property 2: Case creation initializes correctly', async () => {
    await fc.assert(
      fc.asyncProperty(validCaseInputArbitrary, async (input: CreateCaseInput) => {
        // Create the case
        const createdCase = await caseService.createCase(input, testOfficerId);
        createdCaseIds.push(createdCase.id);
        
        // Verify status is OPEN
        expect(createdCase.status).toBe(CaseStatus.OPEN);
        
        // Verify owner_id is set to the creating officer
        expect(createdCase.ownerId).toBe(testOfficerId);
        
        // Verify title and description are preserved
        expect(createdCase.title).toBe(input.title.trim());
        expect(createdCase.description).toBe(input.description.trim());
        
        // Verify priority is set (default or provided)
        expect(createdCase.priority).toBe(input.priority || CasePriority.MEDIUM);
        
        // Verify activity log entry was created
        const { data: activities } = await supabase
          .from('case_activities')
          .select('*')
          .eq('case_id', createdCase.id)
          .eq('activity_type', ActivityType.CASE_CREATED);
        
        expect(activities).toBeDefined();
        expect(activities!.length).toBeGreaterThanOrEqual(1);
        
        const creationActivity = activities![0];
        expect(creationActivity.officer_id).toBe(testOfficerId);
        expect(creationActivity.activity_type).toBe(ActivityType.CASE_CREATED);
        
        return true;
      }),
      { numRuns: 5 }
    );
  }, 60000);

  /**
   * **Feature: case-management-system, Property 3: Case validation rejects invalid input**
   * **Validates: Requirements 1.5**
   * 
   * For any case creation attempt with empty title or empty description,
   * the system SHALL reject the creation and return a validation error.
   */
  it('Property 3: Case validation rejects invalid input', async () => {
    // Test empty title
    const emptyTitleArbitrary = fc.record({
      title: fc.constantFrom('', '   ', '\t', '\n'),
      description: fc.string({ minLength: 1, maxLength: 100 }).map(s => s.replace(/[^\w\s]/g, '') || 'ValidDescription'),
      priority: fc.constantFrom(CasePriority.LOW, CasePriority.MEDIUM, CasePriority.HIGH, CasePriority.CRITICAL)
    });

    await fc.assert(
      fc.asyncProperty(emptyTitleArbitrary, async (input: CreateCaseInput) => {
        try {
          await caseService.createCase(input, testOfficerId);
          // Should not reach here
          expect(true).toBe(false);
        } catch (error) {
          expect(error).toBeInstanceOf(CaseError);
          expect((error as CaseError).code).toBe('VALIDATION_ERROR');
        }
        return true;
      }),
      { numRuns: 5 }
    );

    // Test empty description
    const emptyDescriptionArbitrary = fc.record({
      title: fc.string({ minLength: 1, maxLength: 100 }).map(s => s.replace(/[^\w\s]/g, '') || 'ValidTitle'),
      description: fc.constantFrom('', '   ', '\t', '\n'),
      priority: fc.constantFrom(CasePriority.LOW, CasePriority.MEDIUM, CasePriority.HIGH, CasePriority.CRITICAL)
    });

    await fc.assert(
      fc.asyncProperty(emptyDescriptionArbitrary, async (input: CreateCaseInput) => {
        try {
          await caseService.createCase(input, testOfficerId);
          // Should not reach here
          expect(true).toBe(false);
        } catch (error) {
          expect(error).toBeInstanceOf(CaseError);
          expect((error as CaseError).code).toBe('VALIDATION_ERROR');
        }
        return true;
      }),
      { numRuns: 5 }
    );
  }, 60000);
});


describe('Case Filtering and Sorting Property Tests', () => {
  const createdCaseIds: string[] = [];
  const createdUserIds: string[] = [];
  let testOfficerId: string;
  let testOfficerId2: string;

  beforeEach(async () => {
    // Create test officers
    testOfficerId = `test_officer_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    testOfficerId2 = `test_officer2_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    await supabase.from('users').insert([
      {
        id: testOfficerId,
        username: `TestOfficer_${Date.now()}`,
        role: 'OFFICER',
        created_at: new Date().toISOString()
      },
      {
        id: testOfficerId2,
        username: `TestOfficer2_${Date.now()}`,
        role: 'OFFICER',
        created_at: new Date().toISOString()
      }
    ]);
    createdUserIds.push(testOfficerId, testOfficerId2);
  });

  afterEach(async () => {
    await cleanupTestCases(createdCaseIds);
    createdCaseIds.length = 0;
    await cleanupTestUsers(createdUserIds);
    createdUserIds.length = 0;
  });

  /**
   * **Feature: case-management-system, Property 14: Case filters return matching results**
   * **Validates: Requirements 5.5, 6.3**
   * 
   * For any case list query with filters, all returned cases SHALL match ALL
   * specified filter criteria (status, priority, assigned officer, date range).
   */
  it('Property 14: Case filters return matching results', async () => {
    // Create test cases with different statuses and priorities
    const testCases = [
      { title: 'Test Case 1', description: 'Description 1', priority: CasePriority.HIGH },
      { title: 'Test Case 2', description: 'Description 2', priority: CasePriority.LOW },
      { title: 'Test Case 3', description: 'Description 3', priority: CasePriority.HIGH },
      { title: 'Test Case 4', description: 'Description 4', priority: CasePriority.CRITICAL }
    ];

    for (const tc of testCases) {
      const created = await caseService.createCase(tc, testOfficerId);
      createdCaseIds.push(created.id);
    }

    // Test filtering by priority
    const filterArbitrary = fc.constantFrom(
      CasePriority.LOW,
      CasePriority.MEDIUM,
      CasePriority.HIGH,
      CasePriority.CRITICAL
    );

    await fc.assert(
      fc.asyncProperty(filterArbitrary, async (priority: CasePriority) => {
        const result = await caseService.getCases({ priority });
        
        // All returned cases should match the filter
        for (const c of result.cases) {
          expect(c.priority).toBe(priority);
        }
        
        return true;
      }),
      { numRuns: 4 }
    );

    // Test filtering by status
    const statusFilterArbitrary = fc.constantFrom(
      CaseStatus.OPEN,
      CaseStatus.IN_PROGRESS,
      CaseStatus.UNDER_REVIEW,
      CaseStatus.CLOSED
    );

    await fc.assert(
      fc.asyncProperty(statusFilterArbitrary, async (status: CaseStatus) => {
        const result = await caseService.getCases({ status });
        
        // All returned cases should match the filter
        for (const c of result.cases) {
          expect(c.status).toBe(status);
        }
        
        return true;
      }),
      { numRuns: 4 }
    );
  }, 120000);

  /**
   * **Feature: case-management-system, Property 16: Default sort is by last activity**
   * **Validates: Requirements 6.5**
   * 
   * For any case list retrieval without explicit sort, the cases SHALL be sorted
   * by last_activity_at in descending order.
   */
  it('Property 16: Default sort is by last activity', async () => {
    // Create multiple cases with different timestamps
    const case1 = await caseService.createCase(
      { title: 'Case 1', description: 'First case' },
      testOfficerId
    );
    createdCaseIds.push(case1.id);
    
    // Wait a bit to ensure different timestamps
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const case2 = await caseService.createCase(
      { title: 'Case 2', description: 'Second case' },
      testOfficerId
    );
    createdCaseIds.push(case2.id);
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const case3 = await caseService.createCase(
      { title: 'Case 3', description: 'Third case' },
      testOfficerId
    );
    createdCaseIds.push(case3.id);

    // Retrieve cases without explicit sort
    const result = await caseService.getCases({});
    
    // Filter to only our test cases
    const testCaseResults = result.cases.filter(c => createdCaseIds.includes(c.id));
    
    // Verify they are sorted by last_activity_at descending
    for (let i = 0; i < testCaseResults.length - 1; i++) {
      const currentTime = new Date(testCaseResults[i].lastActivityAt).getTime();
      const nextTime = new Date(testCaseResults[i + 1].lastActivityAt).getTime();
      expect(currentTime).toBeGreaterThanOrEqual(nextTime);
    }
  }, 60000);
});


describe('Case Search Property Tests', () => {
  const createdCaseIds: string[] = [];
  const createdUserIds: string[] = [];
  let testOfficerId: string;

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
    await cleanupTestCases(createdCaseIds);
    createdCaseIds.length = 0;
    await cleanupTestUsers(createdUserIds);
    createdUserIds.length = 0;
  });

  /**
   * **Feature: case-management-system, Property 15: Case search returns relevant results**
   * **Validates: Requirements 6.2**
   * 
   * For any case search query, all returned cases SHALL contain the search term
   * in either the case number, title, or linked subject name.
   */
  it('Property 15: Case search returns relevant results', async () => {
    // Create test cases with distinct titles
    const uniqueMarker = `UNIQUE${Date.now()}`;
    const testCases = [
      { title: `Investigation ${uniqueMarker} Alpha`, description: 'Description 1' },
      { title: `Case ${uniqueMarker} Beta`, description: 'Description 2' },
      { title: 'Unrelated Case', description: 'Description 3' }
    ];

    for (const tc of testCases) {
      const created = await caseService.createCase(tc, testOfficerId);
      createdCaseIds.push(created.id);
    }

    // Search for the unique marker
    const results = await caseService.searchCases(uniqueMarker);
    
    // All results should contain the search term in title or case number
    expect(results.length).toBeGreaterThanOrEqual(2);
    
    for (const result of results) {
      const titleMatch = result.title.toLowerCase().includes(uniqueMarker.toLowerCase());
      const caseNumberMatch = result.caseNumber.toLowerCase().includes(uniqueMarker.toLowerCase());
      
      // At least one should match
      expect(titleMatch || caseNumberMatch).toBe(true);
    }

    // Test with case number search
    const firstCase = results[0];
    const caseNumberResults = await caseService.searchCases(firstCase.caseNumber);
    
    expect(caseNumberResults.length).toBeGreaterThanOrEqual(1);
    expect(caseNumberResults.some(c => c.id === firstCase.id)).toBe(true);
  }, 60000);

  /**
   * Additional test: Empty search returns empty results
   */
  it('Empty search returns empty results', async () => {
    const emptySearchArbitrary = fc.constantFrom('', '   ', '\t', '\n');

    await fc.assert(
      fc.asyncProperty(emptySearchArbitrary, async (query: string) => {
        const results = await caseService.searchCases(query);
        expect(results).toEqual([]);
        return true;
      }),
      { numRuns: 4 }
    );
  }, 30000);
});


describe('Status Workflow Property Tests', () => {
  const createdCaseIds: string[] = [];
  const createdUserIds: string[] = [];
  let testOfficerId: string;

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
    await cleanupTestCases(createdCaseIds);
    createdCaseIds.length = 0;
    await cleanupTestUsers(createdUserIds);
    createdUserIds.length = 0;
  });

  /**
   * **Feature: case-management-system, Property 4: Status transitions follow valid workflow**
   * **Validates: Requirements 2.2**
   * 
   * For any case status change attempt, the system SHALL only allow transitions that
   * follow the workflow: OPEN → IN_PROGRESS, IN_PROGRESS → UNDER_REVIEW, 
   * UNDER_REVIEW → CLOSED. All other transitions SHALL be rejected.
   */
  it('Property 4: Status transitions follow valid workflow', async () => {
    // Valid transitions map
    const validTransitions: Record<CaseStatus, CaseStatus[]> = {
      [CaseStatus.OPEN]: [CaseStatus.IN_PROGRESS],
      [CaseStatus.IN_PROGRESS]: [CaseStatus.UNDER_REVIEW],
      [CaseStatus.UNDER_REVIEW]: [CaseStatus.CLOSED],
      [CaseStatus.CLOSED]: []
    };

    // All possible status pairs
    const allStatuses = [CaseStatus.OPEN, CaseStatus.IN_PROGRESS, CaseStatus.UNDER_REVIEW, CaseStatus.CLOSED];
    
    // Generate arbitrary pairs of (currentStatus, targetStatus)
    const statusPairArbitrary = fc.record({
      currentStatus: fc.constantFrom(...allStatuses),
      targetStatus: fc.constantFrom(...allStatuses)
    });

    await fc.assert(
      fc.asyncProperty(statusPairArbitrary, async ({ currentStatus, targetStatus }) => {
        // Create a case
        const createdCase = await caseService.createCase(
          { title: 'Status Test Case', description: 'Testing status transitions' },
          testOfficerId
        );
        createdCaseIds.push(createdCase.id);

        // Progress the case to the desired current status
        let caseToTest = createdCase;
        const statusPath: CaseStatus[] = [];
        
        // Build path from OPEN to currentStatus
        if (currentStatus !== CaseStatus.OPEN) {
          if (currentStatus === CaseStatus.IN_PROGRESS) {
            statusPath.push(CaseStatus.IN_PROGRESS);
          } else if (currentStatus === CaseStatus.UNDER_REVIEW) {
            statusPath.push(CaseStatus.IN_PROGRESS, CaseStatus.UNDER_REVIEW);
          } else if (currentStatus === CaseStatus.CLOSED) {
            statusPath.push(CaseStatus.IN_PROGRESS, CaseStatus.UNDER_REVIEW, CaseStatus.CLOSED);
          }
        }

        // Progress through the path
        for (const status of statusPath) {
          const closingSummary = status === CaseStatus.CLOSED ? 'Test closing summary' : undefined;
          caseToTest = await caseService.changeStatus(caseToTest.id, status, testOfficerId, closingSummary);
        }

        // Now test the transition from currentStatus to targetStatus
        const isValidTransition = validTransitions[currentStatus].includes(targetStatus);
        
        if (isValidTransition) {
          // Valid transition should succeed
          const closingSummary = targetStatus === CaseStatus.CLOSED ? 'Test closing summary' : undefined;
          const updatedCase = await caseService.changeStatus(caseToTest.id, targetStatus, testOfficerId, closingSummary);
          expect(updatedCase.status).toBe(targetStatus);
        } else {
          // Invalid transition should be rejected
          try {
            await caseService.changeStatus(caseToTest.id, targetStatus, testOfficerId);
            // Should not reach here for invalid transitions
            expect(true).toBe(false);
          } catch (error) {
            expect(error).toBeInstanceOf(CaseError);
            expect((error as CaseError).code).toBe('INVALID_TRANSITION');
          }
        }

        return true;
      }),
      { numRuns: 16 } // Test all 16 possible status pairs
    );
  }, 180000);

  /**
   * **Feature: case-management-system, Property 5: Status changes create activity logs**
   * **Validates: Requirements 2.3**
   * 
   * For any successful status change, an activity log entry SHALL be created
   * containing the previous status, new status, timestamp, and officer ID.
   */
  it('Property 5: Status changes create activity logs', async () => {
    // Test valid transitions
    const validTransitionArbitrary = fc.constantFrom(
      { from: CaseStatus.OPEN, to: CaseStatus.IN_PROGRESS },
      { from: CaseStatus.IN_PROGRESS, to: CaseStatus.UNDER_REVIEW },
      { from: CaseStatus.UNDER_REVIEW, to: CaseStatus.CLOSED }
    );

    await fc.assert(
      fc.asyncProperty(validTransitionArbitrary, async ({ from, to }) => {
        // Create a case
        const createdCase = await caseService.createCase(
          { title: 'Activity Log Test', description: 'Testing activity logging' },
          testOfficerId
        );
        createdCaseIds.push(createdCase.id);

        // Progress to the 'from' status
        let caseToTest = createdCase;
        if (from === CaseStatus.IN_PROGRESS) {
          caseToTest = await caseService.changeStatus(caseToTest.id, CaseStatus.IN_PROGRESS, testOfficerId);
        } else if (from === CaseStatus.UNDER_REVIEW) {
          caseToTest = await caseService.changeStatus(caseToTest.id, CaseStatus.IN_PROGRESS, testOfficerId);
          caseToTest = await caseService.changeStatus(caseToTest.id, CaseStatus.UNDER_REVIEW, testOfficerId);
        }

        // Perform the status change
        const closingSummary = to === CaseStatus.CLOSED ? 'Test closing summary for activity log' : undefined;
        const beforeChange = new Date();
        await caseService.changeStatus(caseToTest.id, to, testOfficerId, closingSummary);
        const afterChange = new Date();

        // Verify activity log was created
        const { data: activities } = await supabase
          .from('case_activities')
          .select('*')
          .eq('case_id', caseToTest.id)
          .eq('activity_type', ActivityType.STATUS_CHANGED)
          .order('created_at', { ascending: false })
          .limit(1);

        expect(activities).toBeDefined();
        expect(activities!.length).toBe(1);

        const activity = activities![0];
        expect(activity.officer_id).toBe(testOfficerId);
        expect(activity.metadata.previousStatus).toBe(from);
        expect(activity.metadata.newStatus).toBe(to);
        
        // Verify timestamp is within expected range
        const activityTime = new Date(activity.created_at);
        expect(activityTime.getTime()).toBeGreaterThanOrEqual(beforeChange.getTime() - 1000);
        expect(activityTime.getTime()).toBeLessThanOrEqual(afterChange.getTime() + 1000);

        return true;
      }),
      { numRuns: 3 }
    );
  }, 120000);

  /**
   * **Feature: case-management-system, Property 6: Closing requires summary**
   * **Validates: Requirements 2.4**
   * 
   * For any status change to CLOSED, the system SHALL require a non-empty closing
   * summary. Attempts to close without a summary SHALL be rejected.
   */
  it('Property 6: Closing requires summary', async () => {
    // Test with various empty/whitespace summaries
    const emptySummaryArbitrary = fc.constantFrom(undefined, '', '   ', '\t', '\n');

    await fc.assert(
      fc.asyncProperty(emptySummaryArbitrary, async (summary: string | undefined) => {
        // Create a case and progress to UNDER_REVIEW
        const createdCase = await caseService.createCase(
          { title: 'Closing Summary Test', description: 'Testing closing summary requirement' },
          testOfficerId
        );
        createdCaseIds.push(createdCase.id);

        // Progress to UNDER_REVIEW
        let caseToTest = await caseService.changeStatus(createdCase.id, CaseStatus.IN_PROGRESS, testOfficerId);
        caseToTest = await caseService.changeStatus(caseToTest.id, CaseStatus.UNDER_REVIEW, testOfficerId);

        // Attempt to close without valid summary
        try {
          await caseService.changeStatus(caseToTest.id, CaseStatus.CLOSED, testOfficerId, summary);
          // Should not reach here
          expect(true).toBe(false);
        } catch (error) {
          expect(error).toBeInstanceOf(CaseError);
          expect((error as CaseError).code).toBe('CLOSING_SUMMARY_REQUIRED');
        }

        return true;
      }),
      { numRuns: 5 }
    );

    // Test with valid summary - should succeed
    const validSummaryArbitrary = fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0);

    await fc.assert(
      fc.asyncProperty(validSummaryArbitrary, async (summary: string) => {
        // Create a case and progress to UNDER_REVIEW
        const createdCase = await caseService.createCase(
          { title: 'Valid Closing Test', description: 'Testing valid closing summary' },
          testOfficerId
        );
        createdCaseIds.push(createdCase.id);

        // Progress to UNDER_REVIEW
        let caseToTest = await caseService.changeStatus(createdCase.id, CaseStatus.IN_PROGRESS, testOfficerId);
        caseToTest = await caseService.changeStatus(caseToTest.id, CaseStatus.UNDER_REVIEW, testOfficerId);

        // Close with valid summary - should succeed
        const closedCase = await caseService.changeStatus(caseToTest.id, CaseStatus.CLOSED, testOfficerId, summary);
        expect(closedCase.status).toBe(CaseStatus.CLOSED);
        expect(closedCase.closingSummary).toBe(summary.trim());

        return true;
      }),
      { numRuns: 3 }
    );
  }, 180000);
});


describe('Closed Case Protection Property Tests', () => {
  const createdCaseIds: string[] = [];
  const createdUserIds: string[] = [];
  let testOfficerId: string;
  let testCommanderId: string;

  beforeEach(async () => {
    testOfficerId = `test_officer_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    testCommanderId = `test_commander_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    await supabase.from('users').insert([
      {
        id: testOfficerId,
        username: `TestOfficer_${Date.now()}`,
        role: 'OFFICER',
        created_at: new Date().toISOString()
      },
      {
        id: testCommanderId,
        username: `TestCommander_${Date.now()}`,
        role: 'CHIEF_COMMANDER',
        created_at: new Date().toISOString()
      }
    ]);
    createdUserIds.push(testOfficerId, testCommanderId);
  });

  afterEach(async () => {
    await cleanupTestCases(createdCaseIds);
    createdCaseIds.length = 0;
    await cleanupTestUsers(createdUserIds);
    createdUserIds.length = 0;
  });

  /**
   * **Feature: case-management-system, Property 7: Closed cases are immutable for non-commanders**
   * **Validates: Requirements 2.5**
   * 
   * For any modification attempt on a CLOSED case by a user with role OFFICER,
   * the system SHALL reject the modification. Only users with role CHIEF_COMMANDER
   * SHALL be able to modify closed cases.
   */
  it('Property 7: Closed cases are immutable for non-commanders', async () => {
    // Generate arbitrary update data
    const updateDataArbitrary = fc.record({
      title: fc.option(fc.string({ minLength: 1, maxLength: 100 }).map(s => s.replace(/[^\w\s]/g, '') || 'UpdatedTitle')),
      description: fc.option(fc.string({ minLength: 1, maxLength: 200 }).map(s => s.replace(/[^\w\s]/g, '') || 'UpdatedDescription')),
      priority: fc.option(fc.constantFrom(CasePriority.LOW, CasePriority.MEDIUM, CasePriority.HIGH, CasePriority.CRITICAL))
    });

    await fc.assert(
      fc.asyncProperty(updateDataArbitrary, async (updateData) => {
        // Create a case and close it
        const createdCase = await caseService.createCase(
          { title: 'Closed Case Test', description: 'Testing closed case protection' },
          testOfficerId
        );
        createdCaseIds.push(createdCase.id);

        // Progress to CLOSED
        let caseToTest = await caseService.changeStatus(createdCase.id, CaseStatus.IN_PROGRESS, testOfficerId);
        caseToTest = await caseService.changeStatus(caseToTest.id, CaseStatus.UNDER_REVIEW, testOfficerId);
        caseToTest = await caseService.changeStatus(caseToTest.id, CaseStatus.CLOSED, testOfficerId, 'Case closed for testing');

        // Build update input (filter out undefined values)
        const updateInput: any = {};
        if (updateData.title !== null) updateInput.title = updateData.title;
        if (updateData.description !== null) updateInput.description = updateData.description;
        if (updateData.priority !== null) updateInput.priority = updateData.priority;

        // Skip if no actual updates
        if (Object.keys(updateInput).length === 0) {
          return true;
        }

        // OFFICER should NOT be able to modify closed case
        try {
          await caseService.updateCase(caseToTest.id, updateInput, testOfficerId, UserRole.OFFICER);
          // Should not reach here
          expect(true).toBe(false);
        } catch (error) {
          expect(error).toBeInstanceOf(CaseError);
          expect((error as CaseError).code).toBe('UNAUTHORIZED_MODIFICATION');
        }

        // CHIEF_COMMANDER SHOULD be able to modify closed case
        const updatedCaseResult = await caseService.updateCase(caseToTest.id, updateInput, testCommanderId, UserRole.CHIEF_COMMANDER);
        
        // Verify the update was applied
        if (updateInput.title) {
          expect(updatedCaseResult.title).toBe(updateInput.title.trim());
        }
        if (updateInput.description) {
          expect(updatedCaseResult.description).toBe(updateInput.description.trim());
        }
        if (updateInput.priority) {
          expect(updatedCaseResult.priority).toBe(updateInput.priority);
        }

        return true;
      }),
      { numRuns: 5 }
    );
  }, 180000);
});


describe('Subject and Search Linking Property Tests', () => {
  const createdCaseIds: string[] = [];
  const createdUserIds: string[] = [];
  let testOfficerId: string;

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
    await cleanupTestCases(createdCaseIds);
    createdCaseIds.length = 0;
    await cleanupTestUsers(createdUserIds);
    createdUserIds.length = 0;
  });

  /**
   * **Feature: case-management-system, Property 8: Subject linking stores complete data**
   * **Validates: Requirements 3.3**
   * 
   * For any subject linking operation, the system SHALL store all required fields:
   * case_id, suspect_face_token, linked_by_officer_id, match_confidence, match_type, linked_at.
   */
  it('Property 8: Subject linking stores complete data', async () => {
    // Generate arbitrary subject linking data
    const linkSubjectArbitrary = fc.record({
      suspectFaceToken: fc.string({ minLength: 10, maxLength: 50 }).map(s => `face_${s.replace(/[^\w]/g, '')}`),
      matchConfidence: fc.float({ min: 0, max: 100, noNaN: true }),
      matchType: fc.constantFrom('EXACT' as const, 'RELATIVE' as const)
    });

    await fc.assert(
      fc.asyncProperty(linkSubjectArbitrary, async (input) => {
        // Create a case
        const createdCase = await caseService.createCase(
          { title: 'Subject Link Test', description: 'Testing subject linking' },
          testOfficerId
        );
        createdCaseIds.push(createdCase.id);

        const beforeLink = new Date();
        
        // Link the subject
        const linkedSubject = await caseService.linkSubject(createdCase.id, input, testOfficerId);
        
        const afterLink = new Date();

        // Verify all required fields are stored
        expect(linkedSubject.id).toBeDefined();
        expect(linkedSubject.caseId).toBe(createdCase.id);
        expect(linkedSubject.suspectFaceToken).toBe(input.suspectFaceToken);
        expect(linkedSubject.linkedByOfficerId).toBe(testOfficerId);
        expect(linkedSubject.matchConfidence).toBeCloseTo(input.matchConfidence, 2);
        expect(linkedSubject.matchType).toBe(input.matchType);
        expect(linkedSubject.linkedAt).toBeDefined();
        
        // Verify timestamp is within expected range
        const linkedTime = new Date(linkedSubject.linkedAt);
        expect(linkedTime.getTime()).toBeGreaterThanOrEqual(beforeLink.getTime() - 1000);
        expect(linkedTime.getTime()).toBeLessThanOrEqual(afterLink.getTime() + 1000);

        // Verify activity log was created
        const { data: activities } = await supabase
          .from('case_activities')
          .select('*')
          .eq('case_id', createdCase.id)
          .eq('activity_type', ActivityType.SUBJECT_LINKED)
          .order('created_at', { ascending: false })
          .limit(1);

        expect(activities).toBeDefined();
        expect(activities!.length).toBe(1);
        expect(activities![0].officer_id).toBe(testOfficerId);
        expect(activities![0].metadata.suspectFaceToken).toBe(input.suspectFaceToken);
        expect(activities![0].metadata.matchConfidence).toBeCloseTo(input.matchConfidence, 2);
        expect(activities![0].metadata.matchType).toBe(input.matchType);

        return true;
      }),
      { numRuns: 5 }
    );
  }, 120000);

  /**
   * **Feature: case-management-system, Property 9: Duplicate subject linking is prevented**
   * **Validates: Requirements 3.6**
   * 
   * For any attempt to link the same subject (face token) to the same case twice,
   * the system SHALL reject the duplicate and return an appropriate error.
   */
  it('Property 9: Duplicate subject linking is prevented', async () => {
    // Generate arbitrary subject linking data
    const linkSubjectArbitrary = fc.record({
      suspectFaceToken: fc.string({ minLength: 10, maxLength: 50 }).map(s => `face_${s.replace(/[^\w]/g, '')}`),
      matchConfidence: fc.float({ min: 0, max: 100, noNaN: true }),
      matchType: fc.constantFrom('EXACT' as const, 'RELATIVE' as const)
    });

    await fc.assert(
      fc.asyncProperty(linkSubjectArbitrary, async (input) => {
        // Create a case
        const createdCase = await caseService.createCase(
          { title: 'Duplicate Link Test', description: 'Testing duplicate prevention' },
          testOfficerId
        );
        createdCaseIds.push(createdCase.id);

        // First link should succeed
        const firstLink = await caseService.linkSubject(createdCase.id, input, testOfficerId);
        expect(firstLink.id).toBeDefined();

        // Second link with same face token should fail
        try {
          await caseService.linkSubject(createdCase.id, input, testOfficerId);
          // Should not reach here
          expect(true).toBe(false);
        } catch (error) {
          expect(error).toBeInstanceOf(CaseError);
          expect((error as CaseError).code).toBe('DUPLICATE_LINK');
        }

        // Verify only one link exists
        const { data: links } = await supabase
          .from('case_linked_subjects')
          .select('*')
          .eq('case_id', createdCase.id)
          .eq('suspect_face_token', input.suspectFaceToken);

        expect(links).toBeDefined();
        expect(links!.length).toBe(1);

        return true;
      }),
      { numRuns: 5 }
    );
  }, 120000);
});


describe('Activity and Timeline Property Tests', () => {
  const createdCaseIds: string[] = [];
  const createdUserIds: string[] = [];
  let testOfficerId: string;

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
    await cleanupTestCases(createdCaseIds);
    createdCaseIds.length = 0;
    await cleanupTestUsers(createdUserIds);
    createdUserIds.length = 0;
  });

  /**
   * **Feature: case-management-system, Property 11: Notes contain required fields**
   * **Validates: Requirements 4.2**
   * 
   * For any note added to a case, the stored note SHALL contain the case ID,
   * officer ID, content, and timestamp.
   */
  it('Property 11: Notes contain required fields', async () => {
    // Import activityService
    const { activityService } = await import('./activityService');

    // Generate arbitrary note content
    const noteContentArbitrary = fc.string({ minLength: 1, maxLength: 500 })
      .map(s => {
        const sanitized = s.replace(/[^\w\s.,!?-]/g, '').trim();
        return sanitized.length > 0 ? sanitized : 'Test note content';
      });

    await fc.assert(
      fc.asyncProperty(noteContentArbitrary, async (content: string) => {
        // Create a case
        const createdCase = await caseService.createCase(
          { title: 'Note Test Case', description: 'Testing note creation' },
          testOfficerId
        );
        createdCaseIds.push(createdCase.id);

        const beforeNote = new Date();

        // Add a note
        const createdNote = await activityService.addNote(
          createdCase.id,
          testOfficerId,
          content
        );

        const afterNote = new Date();

        // Verify all required fields are present
        expect(createdNote.id).toBeDefined();
        expect(createdNote.caseId).toBe(createdCase.id);
        expect(createdNote.officerId).toBe(testOfficerId);
        expect(createdNote.content).toBe(content.trim());
        expect(createdNote.createdAt).toBeDefined();

        // Verify timestamp is within expected range
        const noteTime = new Date(createdNote.createdAt);
        expect(noteTime.getTime()).toBeGreaterThanOrEqual(beforeNote.getTime() - 1000);
        expect(noteTime.getTime()).toBeLessThanOrEqual(afterNote.getTime() + 1000);

        // Verify note is persisted in database
        const { data: dbNote } = await supabase
          .from('case_notes')
          .select('*')
          .eq('id', createdNote.id)
          .single();

        expect(dbNote).toBeDefined();
        expect(dbNote!.case_id).toBe(createdCase.id);
        expect(dbNote!.officer_id).toBe(testOfficerId);
        expect(dbNote!.content).toBe(content.trim());

        // Verify NOTE_ADDED activity was created
        const { data: activities } = await supabase
          .from('case_activities')
          .select('*')
          .eq('case_id', createdCase.id)
          .eq('activity_type', ActivityType.NOTE_ADDED)
          .order('created_at', { ascending: false })
          .limit(1);

        expect(activities).toBeDefined();
        expect(activities!.length).toBeGreaterThanOrEqual(1);
        expect(activities![0].officer_id).toBe(testOfficerId);

        return true;
      }),
      { numRuns: 5 }
    );
  }, 120000);

  /**
   * **Feature: case-management-system, Property 10: Timeline is chronologically ordered**
   * **Validates: Requirements 4.1**
   * 
   * For any case timeline retrieval, the returned entries SHALL be sorted by
   * timestamp in descending order (most recent first).
   */
  it('Property 10: Timeline is chronologically ordered', async () => {
    // Import activityService
    const { activityService } = await import('./activityService');

    // Create a case
    const createdCase = await caseService.createCase(
      { title: 'Timeline Test Case', description: 'Testing timeline ordering' },
      testOfficerId
    );
    createdCaseIds.push(createdCase.id);

    // Add multiple notes with delays to ensure different timestamps
    const noteContents = ['First note', 'Second note', 'Third note'];
    for (const content of noteContents) {
      await activityService.addNote(createdCase.id, testOfficerId, content);
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Change status to create more activities
    await caseService.changeStatus(createdCase.id, CaseStatus.IN_PROGRESS, testOfficerId);
    await new Promise(resolve => setTimeout(resolve, 50));

    // Add another note
    await activityService.addNote(createdCase.id, testOfficerId, 'Note after status change');

    // Get timeline
    const timeline = await activityService.getTimeline(createdCase.id);

    // Verify timeline is not empty
    expect(timeline.length).toBeGreaterThan(0);

    // Verify chronological ordering (descending - most recent first)
    for (let i = 0; i < timeline.length - 1; i++) {
      const currentTime = new Date(timeline[i].timestamp).getTime();
      const nextTime = new Date(timeline[i + 1].timestamp).getTime();
      expect(currentTime).toBeGreaterThanOrEqual(nextTime);
    }

    // Verify timeline contains both activities and notes
    const hasActivities = timeline.some(entry => entry.type === 'activity');
    const hasNotes = timeline.some(entry => entry.type === 'note');
    expect(hasActivities).toBe(true);
    expect(hasNotes).toBe(true);

    // Verify each entry has required fields
    for (const entry of timeline) {
      expect(entry.id).toBeDefined();
      expect(entry.type).toMatch(/^(activity|note)$/);
      expect(entry.timestamp).toBeDefined();
      expect(entry.officerId).toBeDefined();
      expect(entry.content).toBeDefined();
    }
  }, 120000);

  /**
   * Additional test: Timeline ordering with random number of entries
   */
  it('Property 10 (extended): Timeline ordering with varying entries', async () => {
    // Import activityService
    const { activityService } = await import('./activityService');

    // Generate arbitrary number of notes
    const numNotesArbitrary = fc.integer({ min: 2, max: 5 });

    await fc.assert(
      fc.asyncProperty(numNotesArbitrary, async (numNotes: number) => {
        // Create a case
        const createdCase = await caseService.createCase(
          { title: 'Timeline Ordering Test', description: 'Testing timeline with multiple entries' },
          testOfficerId
        );
        createdCaseIds.push(createdCase.id);

        // Add notes with small delays
        for (let i = 0; i < numNotes; i++) {
          await activityService.addNote(createdCase.id, testOfficerId, `Note ${i + 1}`);
          await new Promise(resolve => setTimeout(resolve, 30));
        }

        // Get timeline
        const timeline = await activityService.getTimeline(createdCase.id);

        // Verify ordering
        for (let i = 0; i < timeline.length - 1; i++) {
          const currentTime = new Date(timeline[i].timestamp).getTime();
          const nextTime = new Date(timeline[i + 1].timestamp).getTime();
          expect(currentTime).toBeGreaterThanOrEqual(nextTime);
        }

        return true;
      }),
      { numRuns: 3 }
    );
  }, 180000);
});


describe('Notification Property Tests', () => {
  const createdCaseIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdNotificationIds: string[] = [];
  let testOfficerId: string;
  let testOfficerId2: string;
  let testCommanderId: string;

  // Helper to clean up test notifications
  async function cleanupTestNotifications(notificationIds: string[]): Promise<void> {
    if (notificationIds.length === 0) return;
    await supabase.from('notifications').delete().in('id', notificationIds);
  }

  // Helper to clean up notifications by user
  async function cleanupNotificationsByUser(userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    await supabase.from('notifications').delete().in('user_id', userIds);
  }

  beforeEach(async () => {
    testOfficerId = `test_officer_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    testOfficerId2 = `test_officer2_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    testCommanderId = `test_commander_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    await supabase.from('users').insert([
      {
        id: testOfficerId,
        username: `TestOfficer_${Date.now()}`,
        role: 'OFFICER',
        created_at: new Date().toISOString()
      },
      {
        id: testOfficerId2,
        username: `TestOfficer2_${Date.now()}`,
        role: 'OFFICER',
        created_at: new Date().toISOString()
      },
      {
        id: testCommanderId,
        username: `TestCommander_${Date.now()}`,
        role: 'CHIEF_COMMANDER',
        created_at: new Date().toISOString()
      }
    ]);
    createdUserIds.push(testOfficerId, testOfficerId2, testCommanderId);
  });

  afterEach(async () => {
    await cleanupNotificationsByUser(createdUserIds);
    await cleanupTestNotifications(createdNotificationIds);
    createdNotificationIds.length = 0;
    await cleanupTestCases(createdCaseIds);
    createdCaseIds.length = 0;
    await cleanupTestUsers(createdUserIds);
    createdUserIds.length = 0;
  });

  /**
   * **Feature: case-management-system, Property 12: Assignment creates notifications**
   * **Validates: Requirements 5.2, 5.3**
   * 
   * For any case assignment, a notification SHALL be created for the assigned
   * officer with type CASE_ASSIGNED and the correct case ID.
   */
  it('Property 12: Assignment creates notifications', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 3 }), async () => {
        // Create a case
        const createdCase = await caseService.createCase(
          { title: 'Assignment Notification Test', description: 'Testing assignment notifications' },
          testOfficerId
        );
        createdCaseIds.push(createdCase.id);

        // Assign the case to another officer
        await caseService.assignOfficer(createdCase.id, testOfficerId2, testCommanderId);

        // Verify notification was created for the assigned officer
        const { data: notifications } = await supabase
          .from('notifications')
          .select('*')
          .eq('user_id', testOfficerId2)
          .eq('case_id', createdCase.id)
          .eq('type', 'CASE_ASSIGNED');

        expect(notifications).toBeDefined();
        expect(notifications!.length).toBeGreaterThanOrEqual(1);

        const notification = notifications![0];
        expect(notification.user_id).toBe(testOfficerId2);
        expect(notification.type).toBe('CASE_ASSIGNED');
        expect(notification.case_id).toBe(createdCase.id);
        expect(notification.message).toContain(createdCase.caseNumber);
        expect(notification.is_read).toBe(false);

        // Track for cleanup
        createdNotificationIds.push(notification.id);

        return true;
      }),
      { numRuns: 3 }
    );
  }, 120000);

  /**
   * **Feature: case-management-system, Property 13: Status changes notify relevant parties**
   * **Validates: Requirements 5.4**
   * 
   * For any case status change, notifications SHALL be created for both the case
   * owner and the assigned officer (if different from the actor).
   */
  it('Property 13: Status changes notify relevant parties', async () => {
    // Create a case owned by testOfficerId
    const createdCase = await caseService.createCase(
      { title: 'Status Notification Test', description: 'Testing status change notifications' },
      testOfficerId
    );
    createdCaseIds.push(createdCase.id);

    // Assign the case to testOfficerId2
    await caseService.assignOfficer(createdCase.id, testOfficerId2, testCommanderId);

    // Clear any existing notifications to start fresh
    await supabase
      .from('notifications')
      .delete()
      .eq('case_id', createdCase.id);

    // Change status by the commander (different from owner and assignee)
    await caseService.changeStatus(createdCase.id, CaseStatus.IN_PROGRESS, testCommanderId);

    // Verify notifications were created for owner and assignee
    const { data: ownerNotifications } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', testOfficerId)
      .eq('case_id', createdCase.id)
      .eq('type', 'STATUS_CHANGED');

    const { data: assigneeNotifications } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', testOfficerId2)
      .eq('case_id', createdCase.id)
      .eq('type', 'STATUS_CHANGED');

    // Owner should receive notification (since commander made the change)
    expect(ownerNotifications).toBeDefined();
    expect(ownerNotifications!.length).toBeGreaterThanOrEqual(1);
    expect(ownerNotifications![0].message).toContain('OPEN');
    expect(ownerNotifications![0].message).toContain('IN_PROGRESS');

    // Assignee should receive notification (since commander made the change)
    expect(assigneeNotifications).toBeDefined();
    expect(assigneeNotifications!.length).toBeGreaterThanOrEqual(1);
    expect(assigneeNotifications![0].message).toContain('OPEN');
    expect(assigneeNotifications![0].message).toContain('IN_PROGRESS');

    // Track for cleanup
    if (ownerNotifications) {
      createdNotificationIds.push(...ownerNotifications.map(n => n.id));
    }
    if (assigneeNotifications) {
      createdNotificationIds.push(...assigneeNotifications.map(n => n.id));
    }
  }, 120000);

  /**
   * Property 13 (extended): Actor should not receive notification for their own action
   */
  it('Property 13 (extended): Actor does not receive self-notification', async () => {
    // Create a case owned by testOfficerId
    const createdCase = await caseService.createCase(
      { title: 'Self Notification Test', description: 'Testing no self-notification' },
      testOfficerId
    );
    createdCaseIds.push(createdCase.id);

    // Clear any existing notifications
    await supabase
      .from('notifications')
      .delete()
      .eq('case_id', createdCase.id);

    // Owner changes status themselves
    await caseService.changeStatus(createdCase.id, CaseStatus.IN_PROGRESS, testOfficerId);

    // Owner should NOT receive notification for their own action
    const { data: ownerNotifications } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', testOfficerId)
      .eq('case_id', createdCase.id)
      .eq('type', 'STATUS_CHANGED');

    expect(ownerNotifications).toBeDefined();
    expect(ownerNotifications!.length).toBe(0);
  }, 60000);
});
