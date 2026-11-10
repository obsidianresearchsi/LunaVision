import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ResultsPage } from './Results';
import { recordAnalystReview } from '../services/analystReviewService';
import { SearchResult } from '../types';
import { formatSimilarity, similarityTier } from '../utils/similarityPresentation';
import { caseReportGenerator } from '../services/caseReportGenerator';
import { CaseStatus, CasePriority } from '../types';
vi.mock('../services/caseService', () => ({ caseService: { getCases: vi.fn().mockResolvedValue({ cases: [] }) } }));
vi.mock('../services/analystReviewService', () => ({ recordAnalystReview: vi.fn(), REVIEW_OUTCOMES: {} }));
afterEach(() => vi.restoreAllMocks());
const results: SearchResult[] = ['EXACT', 'RELATIVE'].map((type, index) => ({ suspect: { faceToken: `fixture-${index}`, name: `Fictional candidate ${index}`, crime: 'Unverified source record', nin: '', location: 'Not recorded', imageUrl: '/demo/subject-01.jpg', sourceUrl: 'Fixture', status: 'WANTED' }, confidence: index ? 68.2 : 92.4, matchType: type as SearchResult['matchType'] }));

it('uses neutral similarity labels without changing the stored legacy tier codes', () => {
  expect(similarityTier('EXACT')).toBe('Higher similarity'); expect(similarityTier('RELATIVE')).toBe('Lower similarity');
  expect(formatSimilarity(92.4)).toBe('92.4 / 100'); expect(formatSimilarity(NaN)).toBe('Unavailable');
});

it('preserves analyst reasoning and provenance in the case report without exporting a kinship assertion', () => {
  const reviewText = '[ANALYST REVIEW / v1]\nOutcome: Needs more evidence\nSearch session: search-original\nReviewer: officer-original\nRationale: independent source context is missing.';
  const report = caseReportGenerator.generateReport({ id: 'case-1', caseNumber: 'CASE-1', title: 'Review file', description: 'Synthetic fixture', status: CaseStatus.OPEN, priority: CasePriority.MEDIUM, ownerId: 'officer-original', createdAt: '2026-11-02', updatedAt: '2026-11-02', lastActivityAt: '2026-11-02',
    linkedSubjects: [{ id: 'subject-link', caseId: 'case-1', suspectFaceToken: 'fixture-1', linkedByOfficerId: 'officer-original', matchConfidence: 68.2, matchType: 'RELATIVE', linkedAt: '2026-11-02' }], linkedSearches: [], activities: [],
    notes: [{ id: 'review-note', caseId: 'case-1', officerId: 'officer-original', content: reviewText, createdAt: '2026-11-02' }]
  });
  expect(report.content).toContain('68.2 / 100'); expect(report.content).toContain('Lower similarity');
  expect(report.content).toContain('Search session: search-original'); expect(report.content).toContain('independent source context is missing.');
  expect(report.content).not.toContain('Match Type:       RELATIVE'); expect(report.content).not.toContain('68.20%');
});

it('removes confirmation and kinship claims from results and printable output while retaining provenance', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); const panelHost = document.createElement('div');
  document.body.append(host, panelHost); const root = createRoot(host), panelRoot = createRoot(panelHost);
  let panel: React.ReactNode = null;
  try {
    await act(async () => root.render(<ResultsPage results={results} probeImage="data:image/png;base64,AA==" analysis={'Lighting is uneven.\nEthnic heritage: unsupported inference\nMood: threatening'} telemetry={null} officerId="officer-original" auditLogId="search-original" onReset={() => {}} setRightPanel={value => { panel = value; }}/>));
    await act(async () => panelRoot.render(panel));
    const invalidClaims = /HIGH VALUE TARGET IDENTIFIED|FAMILIAL LINK|Genetic\/Kinship|Confirmed Match|THREAT:|INVESTIGATE ASSOCIATES|threatening|unsupported inference/;
    expect(document.body.textContent).not.toMatch(invalidClaims);
    expect(host.textContent).toContain('92.4 / 100'); expect(host.textContent).toContain('Lower similarity');
    expect(panelHost.textContent).toContain('Lighting is uneven.');
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Print Case File')!.click());
    expect(document.body.textContent).not.toMatch(invalidClaims);
    expect(document.body.textContent).toContain('Search session: search-original');
    expect(document.body.textContent).toContain('Requested by: officer-original');
    expect(document.body.textContent).toContain('REVIEW: REQUIRED');
    expect(recordAnalystReview).not.toHaveBeenCalled();
  } finally { await act(async () => { root.unmount(); panelRoot.unmount(); }); host.remove(); panelHost.remove(); }
});
