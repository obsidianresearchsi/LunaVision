import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CasesPage } from './Cases';
import { History } from './History';
import { AddToCaseModal } from '../components/AddToCaseModal';
import { LinkSearchToCaseModal } from '../components/LinkSearchToCaseModal';
import { CasePriority, CaseStatus, UserRole } from '../types';
import { caseService } from '../services/caseService';
import { supabaseDb } from '../services/supabaseDb';

vi.mock('../services/caseService', () => ({ caseService: {
  getCases: vi.fn(), searchCases: vi.fn(), createCase: vi.fn(), linkSubject: vi.fn(), linkSearch: vi.fn()
} }));
vi.mock('../services/supabaseDb', () => ({ supabaseDb: { getAuditLogs: vi.fn() } }));

const user = { id: 'officer-real', username: 'Analyst', role: UserRole.OFFICER, createdAt: '2026-01-01' };
const activeCase = { id: 'case-active', caseNumber: 'CASE-20261031-0001', title: 'Harbor inquiry', description: 'Investigate recorded evidence', status: CaseStatus.OPEN, priority: CasePriority.HIGH, ownerId: user.id, createdAt: '2026-10-31', updatedAt: '2026-10-31', lastActivityAt: '2026-10-31' };
const closedCase = { ...activeCase, id: 'case-closed', caseNumber: 'CASE-CLOSED', title: 'Closed inquiry', status: CaseStatus.CLOSED };
const subject = { suspect: { faceToken: 'face-1', name: 'Subject A', crime: 'Test', nin: '123', location: 'Abuja', imageUrl: '', sourceUrl: 'police_db' }, confidence: 92.4, matchType: 'EXACT' as const };

describe('Investigation workflows', () => {
  let root: Root; let host: HTMLDivElement;
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(caseService.getCases).mockResolvedValue({ cases: [activeCase, closedCase], total: 2, page: 1, pageSize: 10 });
    vi.mocked(caseService.linkSubject).mockResolvedValue({} as any);
    vi.mocked(caseService.linkSearch).mockResolvedValue({} as any);
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
  const render = async (element: React.ReactNode) => { await act(async () => root.render(element)); };
  const button = (text: string) => {
    const found = [...host.querySelectorAll('button')].find(node => node.textContent?.trim() === text);
    expect(found, `Button ${text}`).toBeTruthy(); return found!;
  };
  const click = async (node: HTMLElement) => { await act(async () => node.click()); };

  it('opens the same case from its register using the keyboard', async () => {
    const navigate = vi.fn();
    await render(<CasesPage user={user} onNavigateToCase={navigate}/>);
    const card = host.querySelector<HTMLElement>('[aria-label="Open case CASE-20261031-0001: Harbor inquiry"]')!;
    expect(card).toBeTruthy();
    await act(async () => card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(navigate).toHaveBeenCalledWith('case-active');
    await click(button('Filters'));
    expect(host.textContent).toContain('Apply Filters');
    await click(button('New Case'));
    expect(host.querySelector('form')).toBeTruthy();
  });

  it('links a subject and its actual search ID to an active case with officer attribution', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn(); const onSuccess = vi.fn();
    await render(<AddToCaseModal subject={subject} currentOfficerId={user.id} auditLogId="audit-real" onClose={onClose} onSuccess={onSuccess}/>);
    expect(host.textContent).not.toContain('Closed inquiry');
    await click([...host.querySelectorAll('button')].find(node => node.textContent?.includes('Harbor inquiry'))!);
    expect(host.querySelector('.case-link-destination')?.textContent).toContain('Harbor inquiry');
    await click(button('Link to Case'));
    expect(caseService.linkSubject).toHaveBeenCalledWith('case-active', { suspectFaceToken: 'face-1', matchConfidence: 92.4, matchType: 'EXACT' }, user.id);
    expect(caseService.linkSearch).toHaveBeenCalledWith('case-active', 'audit-real', user.id);
    expect(onSuccess).toHaveBeenCalledWith('case-active');
    await act(async () => vi.advanceTimersByTime(1500)); expect(onClose).toHaveBeenCalled();
  });

  it('can link a search without silently adding subjects and preserves Escape close', async () => {
    const close = vi.fn();
    await render(<LinkSearchToCaseModal auditLogId="audit-real" searchResults={[subject]} currentOfficerId={user.id} onClose={close}/>);
    await click([...host.querySelectorAll('button')].find(node => node.textContent?.includes('Harbor inquiry'))!);
    await click(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    expect(host.querySelector('.case-link-preview')?.textContent).toContain('Subject associations are not added');
    await click(button('Link Search'));
    expect(caseService.linkSearch).toHaveBeenCalledWith('case-active', 'audit-real', user.id);
    expect(caseService.linkSubject).not.toHaveBeenCalled();
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(close).toHaveBeenCalled();
  });

  it('keeps history scoped to the current officer and opens the original audit record for linking', async () => {
    vi.mocked(supabaseDb.getAuditLogs).mockResolvedValue([
      { logId: 'audit-local', officerId: user.id, timestamp: '2026-10-31', searchType: 'LOCAL', searchImagePath: 'data:image/png;base64,AA==', resultCount: 2 },
      { logId: 'audit-web', officerId: user.id, timestamp: '2026-10-30', searchType: 'DEEP_WEB', searchImagePath: 'AA==', resultCount: 1 },
      { logId: 'other-officer-audit', officerId: 'another-officer', timestamp: '2026-10-31', searchType: 'LOCAL', searchImagePath: 'AA==', resultCount: 7 }
    ]);
    await render(<History user={user}/>);
    expect(host.querySelectorAll('.history-record')).toHaveLength(2);
    expect(host.textContent).not.toContain('other-officer-audit');
    await click(button('Local'));
    expect(host.querySelectorAll('.history-record')).toHaveLength(1);
    await click(button('Link to case'));
    expect(host.querySelector('.case-link-preview')?.textContent).toContain('audit-local');
    await click([...host.querySelectorAll('button')].find(node => node.textContent?.includes('Harbor inquiry'))!);
    await click(button('Link Search'));
    expect(caseService.linkSearch).toHaveBeenCalledWith('case-active', 'audit-local', user.id);
  });
  it('reports partial linking failures instead of closing as if every association succeeded', async () => {
    vi.useFakeTimers();
    vi.mocked(caseService.linkSubject).mockRejectedValueOnce(new Error('Association unavailable'));
    const close = vi.fn();
    await render(<LinkSearchToCaseModal auditLogId="audit-real" searchResults={[subject]} currentOfficerId={user.id} onClose={close}/>);
    await click([...host.querySelectorAll('button')].find(node => node.textContent?.includes('Harbor inquiry'))!);
    await click(button('Link Search'));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('1 subject association(s) could not be saved');
    expect(host.textContent).toContain('0 subject(s) added');
    await act(async () => vi.advanceTimersByTime(1500));
    expect(close).not.toHaveBeenCalled();
  });
  it('keeps a saved subject visible when its optional search association fails', async () => {
    vi.useFakeTimers();
    vi.mocked(caseService.linkSearch).mockRejectedValueOnce(new Error('Search link unavailable'));
    const close = vi.fn();
    await render(<AddToCaseModal subject={subject} auditLogId="audit-real" currentOfficerId={user.id} onClose={close}/>);
    await click([...host.querySelectorAll('button')].find(node => node.textContent?.includes('Harbor inquiry'))!);
    await click(button('Link to Case'));
    expect(caseService.linkSubject).toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('subject was saved');
    await act(async () => vi.advanceTimersByTime(1500));
    expect(close).not.toHaveBeenCalled();
  });
});
