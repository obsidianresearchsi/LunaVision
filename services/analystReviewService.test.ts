import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordAnalystReview, AnalystReviewInput } from './analystReviewService';
import { caseService } from './caseService';
import { activityService } from './activityService';
import { CaseStatus } from '../types';
vi.mock('./caseService', () => ({ caseService: { getCase: vi.fn(), linkSubject: vi.fn(), linkSearch: vi.fn() } }));
vi.mock('./activityService', () => ({ activityService: { addNote: vi.fn() } }));
const input: AnalystReviewInput = {
  caseId: 'case-1', auditLogId: 'original-search', officerId: 'reviewer-1', outcome: 'NEEDS_MORE_EVIDENCE', rationale: 'Source context is incomplete; independent evidence is missing.', acknowledgedLimitations: true,
  candidate: { suspect: { faceToken: 'record-1', name: 'Fictional record', crime: '', nin: '', location: '', imageUrl: '', sourceUrl: '' }, confidence: 92.417, matchType: 'RELATIVE' }
};
describe('Analyst review audit records', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(caseService.getCase).mockResolvedValue({ status: CaseStatus.OPEN } as any); vi.mocked(activityService.addNote).mockResolvedValue({ id: 'saved-note', createdAt: '2026-11-02' } as any); });
  it('records the original search, reviewer, rationale, and non-identifying interpretation through case notes', async () => {
    const result = await recordAnalystReview(input);
    expect(result.id).toBe('saved-note');
    expect(activityService.addNote).toHaveBeenCalledWith('case-1', 'reviewer-1', expect.stringContaining('Search session: original-search'));
    const note = vi.mocked(activityService.addNote).mock.calls[0][2];
    for (const text of ['Candidate record: record-1', '92.4 / 100', 'Raw provider similarity: 92.417', 'Lower similarity', 'Needs more evidence', input.rationale, 'does not confirm identity']) expect(note).toContain(text);
    expect(note).not.toContain('92.4%');
    expect(caseService.linkSubject).not.toHaveBeenCalled(); expect(caseService.linkSearch).not.toHaveBeenCalled();
  });
  it('requires an explicit outcome, meaningful rationale, and limitations acknowledgement', async () => {
    for (const patch of [{ outcome: 'CONFIRMED_IDENTITY' }, { rationale: 'ok' }, { acknowledgedLimitations: false }, { auditLogId: '' }, { officerId: '' }]) {
      await expect(recordAnalystReview({ ...input, ...patch } as AnalystReviewInput)).rejects.toThrow();
    }
    expect(activityService.addNote).not.toHaveBeenCalled();
  });
  it('refuses closed cases and propagates audit-write failures without claiming success', async () => {
    vi.mocked(caseService.getCase).mockResolvedValueOnce({ status: CaseStatus.CLOSED } as any);
    await expect(recordAnalystReview(input)).rejects.toThrow('closed');
    expect(activityService.addNote).not.toHaveBeenCalled();
    vi.mocked(activityService.addNote).mockRejectedValueOnce(new Error('Write failed'));
    await expect(recordAnalystReview(input)).rejects.toThrow('Write failed');
  });
});
