import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { Dashboard } from './Dashboard';
import { supabaseDb } from '../services/supabaseDb';
vi.mock('../services/supabaseDb', () => ({ supabaseDb: { getSuspects: vi.fn(), getUsers: vi.fn(), getAuditLogs: vi.fn() } }));
afterEach(() => vi.clearAllMocks());
it('shows history without waiting for a slow collection and exposes failures with retry', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  let rejectSubjects!: (error: Error) => void;
  vi.mocked(supabaseDb.getSuspects).mockReturnValue(new Promise((_, reject) => { rejectSubjects = reject; }));
  vi.mocked(supabaseDb.getUsers).mockResolvedValue([]);
  vi.mocked(supabaseDb.getAuditLogs).mockResolvedValue([{ logId: 'audit-fixture', officerId: 'officer-fixture', timestamp: '2026-11-02', searchType: 'LOCAL', resultCount: 0, searchImagePath: '' }]);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<Dashboard/>));
    expect(host.textContent).toContain('officer-fixture');
    expect(host.textContent).toContain('Loading database records');
    expect(supabaseDb.getAuditLogs).toHaveBeenCalledWith({ includeImages: false });
    await act(async () => rejectSubjects(new Error('Network failure')));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Subject records could not be loaded.');
    expect(host.textContent).toContain('officer-fixture');
    vi.mocked(supabaseDb.getSuspects).mockResolvedValue([]);
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Retry loading records')!.click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
