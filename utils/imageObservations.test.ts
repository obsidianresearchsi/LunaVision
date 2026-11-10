import { expect, it } from 'vitest';
import { imageObservations } from './imageObservations';
import { buildCaseReportHtml } from '../services/caseReportGenerator';

it('keeps tentative image conditions while suppressing age and personal claims', () => {
  expect(imageObservations('Lighting is uneven.\nAge: 32 years\nLooks 24 years old\nGender: male\nMood: angry\nBlur is visible.').notes)
    .toEqual(['Lighting is uneven.', 'Blur is visible.']);
});
it('never presents a provider error or empty response as an observation', () => {
  for (const message of ['', 'Analysis Unavailable: secret backend error', 'API rate limit reached.', 'Invalid Gemini API key.', 'Analysis complete. No additional details available.']) {
    expect(imageObservations(message)).toEqual({ notes: [], unavailable: true });
  }
});
it('escapes case content and metadata in the styled PDF document', () => {
  const html = buildCaseReportHtml({ content: '==========\nCASE DETAILS\n==========\n<script>alert(1)</script>\nReviewer: Ada\nRationale: source context missing.', caseNumber: '<img src=x onerror=alert(1)>', generatedAt: '2026-11-02', caseId: '1', sections: { header: true, caseDetails: true, linkedSubjects: true, timeline: true, notes: true } });
  expect(html).not.toContain('<script>'); expect(html).not.toContain('<img src=x');
  expect(html).toContain('&lt;script&gt;'); expect(html).toContain('Rationale: source context missing.');
  expect(html).toContain('@page{size:A4'); expect(html).toContain('case-section');
});
