import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CandidateReviewModal } from './CandidateReviewModal';
import { caseService } from '../services/caseService';
import { recordAnalystReview } from '../services/analystReviewService';
import { CaseStatus, SearchResult } from '../types';
vi.mock('../services/caseService', () => ({ caseService: { getCases: vi.fn() } }));
vi.mock('../services/analystReviewService', () => ({ recordAnalystReview: vi.fn(), REVIEW_OUTCOMES: { NEEDS_MORE_EVIDENCE: 'Needs more evidence', EXCLUDED: 'Excluded from this investigation', REVIEWED_NO_CONCLUSION: 'Reviewed — no identity conclusion' } }));
const results: SearchResult[] = [1, 2].map(id => ({ suspect: { faceToken: `record-${id}`, name: `Fictional candidate ${id}`, crime: '', nin: '', location: '', imageUrl: '', sourceUrl: '' }, confidence: 80, matchType: 'RELATIVE' }));
describe('Explicit analyst review controls', () => {
  let host: HTMLDivElement; let root: Root;
  beforeEach(() => {
    vi.clearAllMocks(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(caseService.getCases).mockResolvedValue({ cases: [{ id: 'active-case', title: 'Active file', caseNumber: 'CASE-1', status: CaseStatus.OPEN }, { id: 'closed-case', title: 'Closed file', status: CaseStatus.CLOSED }] } as any);
    vi.mocked(recordAnalystReview).mockResolvedValue({ id: 'review-note', createdAt: '2026-11-02' } as any);
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
  const render = async () => { await act(async () => root.render(<CandidateReviewModal results={results} auditLogId="search-original" officerId="reviewer-real" onClose={() => {}}/>)); };
  const select = async (id: string, value: string) => { const node = document.getElementById(id) as HTMLSelectElement; await act(async () => { node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); }); };
  const rationale = async (text: string) => { const node = document.getElementById('review-rationale') as HTMLTextAreaElement; await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(node, text); node.dispatchEvent(new Event('input', { bubbles: true })); }); };
  const submit = () => document.querySelector<HTMLButtonElement>('.analyst-review-actions button[type="submit"]')!;
  async function completeForm() {
    await select('review-case', 'active-case'); await select('review-outcome', 'NEEDS_MORE_EVIDENCE'); await rationale('Independent evidence is currently insufficient.');
    await act(async () => document.querySelector<HTMLInputElement>('.analyst-review-ack input')!.click());
  }
  it('requires explicit reviewer input and excludes closed cases before saving', async () => {
    await render(); expect(submit().disabled).toBe(true); expect(recordAnalystReview).not.toHaveBeenCalled();
    expect(document.getElementById('review-case')?.textContent).not.toContain('Closed file');
    await completeForm(); expect(submit().disabled).toBe(false);
    await act(async () => submit().click());
    expect(recordAnalystReview).toHaveBeenCalledWith(expect.objectContaining({ caseId: 'active-case', auditLogId: 'search-original', officerId: 'reviewer-real', outcome: 'NEEDS_MORE_EVIDENCE', acknowledgedLimitations: true }));
    expect(document.body.textContent).toContain('Review recorded in case timeline');
    expect(document.body.textContent).toContain('review-note');
  });
  it('resets reasoning and acknowledgement when the candidate changes', async () => {
    await render(); await completeForm(); await select('review-candidate', 'record-2');
    expect((document.getElementById('review-rationale') as HTMLTextAreaElement).value).toBe('');
    expect(document.querySelector<HTMLInputElement>('.analyst-review-ack input')!.checked).toBe(false);
    expect(submit().disabled).toBe(true); expect(recordAnalystReview).not.toHaveBeenCalled();
  });
  it('keeps the form and error visible if the audit record cannot be fully written', async () => {
    vi.mocked(recordAnalystReview).mockRejectedValueOnce(new Error('Audit unavailable'));
    await render(); await completeForm(); await act(async () => submit().click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Audit unavailable');
    expect(document.body.textContent).not.toContain('Review recorded in case timeline');
    expect(document.getElementById('review-rationale')).toBeTruthy();
  });
});
