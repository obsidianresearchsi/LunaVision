/**
 * Property-Based Tests for Case Report Generator
 * 
 * These tests validate correctness properties for report generation.
 * Each test verifies that generated reports contain all required sections
 * and conform to the official format.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { caseReportGenerator } from './caseReportGenerator';
import { caseService } from './caseService';
import { activityService } from './activityService';
import { supabase } from './supabase';
import {
  CaseWithDetails,
  CaseStatus,
  CasePriority,
  ActivityType,
  CaseLinkedSubject,
  CaseActivity,
  CaseNote
} from '../types';

// Helper to clean up test cases
async function cleanupTestCases(caseIds: string[]): Promise<void> {
  if (caseIds.length === 0) return;
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

// Arbitrary for generating valid case input
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


describe('Case Report Content Property Tests', () => {
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
   * **Feature: case-management-system, Property 17: Report contains all required sections**
   * **Validates: Requirements 7.2**
   * 
   * For any case report generation, the output SHALL contain the case details,
   * all linked subjects, the complete timeline, and all notes.
   */
  it('Property 17: Report contains all required sections', async () => {
    await fc.assert(
      fc.asyncProperty(validCaseInputArbitrary, async (input) => {
        // Create a case
        const createdCase = await caseService.createCase(input, testOfficerId);
        createdCaseIds.push(createdCase.id);

        // Add some notes to the case
        await activityService.addNote(createdCase.id, testOfficerId, 'Test note for report');
        await activityService.addNote(createdCase.id, testOfficerId, 'Another test note');

        // Get the full case with details
        const caseWithDetails = await caseService.getCase(createdCase.id);

        // Generate the report
        const report = caseReportGenerator.generateReport(caseWithDetails);

        // Verify all sections are present
        expect(report.sections.header).toBe(true);
        expect(report.sections.caseDetails).toBe(true);
        expect(report.sections.linkedSubjects).toBe(true);
        expect(report.sections.timeline).toBe(true);
        expect(report.sections.notes).toBe(true);

        // Verify the report validates
        expect(caseReportGenerator.validateReportSections(report)).toBe(true);

        // Verify case details are in the content
        expect(caseReportGenerator.hasCaseDetails(report, caseWithDetails)).toBe(true);
        expect(report.content).toContain(caseWithDetails.caseNumber);
        expect(report.content).toContain(caseWithDetails.title);
        expect(report.content).toContain(caseWithDetails.description);

        // Verify timeline section exists
        expect(report.content).toContain('ACTIVITY TIMELINE');

        // Verify notes section exists
        expect(report.content).toContain('CASE NOTES');

        // Verify linked subjects section exists
        expect(report.content).toContain('LINKED SUBJECTS');

        // Verify all notes are in the report
        expect(caseReportGenerator.hasAllNotes(report, caseWithDetails.notes)).toBe(true);

        return true;
      }),
      { numRuns: 5 }
    );
  }, 120000);
});


describe('Case Report Header Property Tests', () => {
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
   * **Feature: case-management-system, Property 18: Report includes official header**
   * **Validates: Requirements 7.4**
   * 
   * For any case report generation, the output SHALL include the EagleEye header
   * with "FEDERAL REPUBLIC OF NIGERIA", agency name, and "CONFIDENTIAL" classification marking.
   */
  it('Property 18: Report includes official header', async () => {
    await fc.assert(
      fc.asyncProperty(validCaseInputArbitrary, async (input) => {
        // Create a case
        const createdCase = await caseService.createCase(input, testOfficerId);
        createdCaseIds.push(createdCase.id);

        // Get the full case with details
        const caseWithDetails = await caseService.getCase(createdCase.id);

        // Generate the report
        const report = caseReportGenerator.generateReport(caseWithDetails);

        // Verify official header is present
        expect(caseReportGenerator.hasOfficialHeader(report)).toBe(true);

        // Verify specific header elements
        expect(report.content).toContain('FEDERAL REPUBLIC OF NIGERIA');
        expect(report.content).toContain('EAGLEEYE');
        expect(report.content).toContain('CONFIDENTIAL');

        // Verify the header appears at the beginning of the report
        const headerIndex = report.content.indexOf('FEDERAL REPUBLIC OF NIGERIA');
        expect(headerIndex).toBeLessThan(200); // Should be near the start

        // Verify classification marking appears
        const confidentialCount = (report.content.match(/CONFIDENTIAL/g) || []).length;
        expect(confidentialCount).toBeGreaterThanOrEqual(1);

        return true;
      }),
      { numRuns: 5 }
    );
  }, 120000);
});


describe('Case Report Logging Property Tests', () => {
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
   * **Feature: case-management-system, Property 19: Report generation is logged**
   * **Validates: Requirements 7.5**
   * 
   * For any case report generation, an activity log entry of type REPORT_GENERATED
   * SHALL be created.
   */
  it('Property 19: Report generation is logged', async () => {
    await fc.assert(
      fc.asyncProperty(validCaseInputArbitrary, async (input) => {
        // Create a case
        const createdCase = await caseService.createCase(input, testOfficerId);
        createdCaseIds.push(createdCase.id);

        // Get the full case with details
        const caseWithDetails = await caseService.getCase(createdCase.id);

        // Generate the report and log the activity
        const report = caseReportGenerator.generateReport(caseWithDetails);
        
        // Log the report generation activity
        await activityService.logActivity(
          createdCase.id,
          ActivityType.REPORT_GENERATED,
          testOfficerId,
          { reportGeneratedAt: report.generatedAt }
        );

        // Verify activity log was created
        const { data: activities } = await supabase
          .from('case_activities')
          .select('*')
          .eq('case_id', createdCase.id)
          .eq('activity_type', ActivityType.REPORT_GENERATED);

        expect(activities).toBeDefined();
        expect(activities!.length).toBeGreaterThanOrEqual(1);

        const reportActivity = activities![0];
        expect(reportActivity.officer_id).toBe(testOfficerId);
        expect(reportActivity.activity_type).toBe(ActivityType.REPORT_GENERATED);

        return true;
      }),
      { numRuns: 5 }
    );
  }, 120000);
});
