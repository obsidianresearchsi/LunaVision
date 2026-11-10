import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { SearchPage } from './Search';
import { supabaseDb } from '../services/supabaseDb';
import { UserRole } from '../types';

vi.mock('../services/faceEngine', () => ({
  searchCriminalDatabase: vi.fn().mockResolvedValue({ results: [], telemetry: null }),
  analyzeSuspectImage: vi.fn().mockResolvedValue('Image analysis')
}));
vi.mock('../services/supabaseDb', () => ({ supabaseDb: { logSearch: vi.fn().mockResolvedValue(undefined) } }));
afterEach(() => { vi.unstubAllGlobals(); });

it('returns the ID of the persisted audit record alongside the original search result payload', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('FileReader', class {
    onload?: (event: any) => void;
    readAsDataURL() { this.onload?.({ target: { result: 'data:image/jpeg;base64,AAAA' } }); }
  });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); const onResults = vi.fn();
  try {
    await act(async () => root.render(<SearchPage user={{ id: 'actual-officer', username: 'Analyst', role: UserRole.OFFICER, createdAt: '2026-01-01' }} onResults={onResults} setRightPanel={() => {}}/>));
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [new File(['probe'], 'probe.jpg', { type: 'image/jpeg' })] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    const saved = vi.mocked(supabaseDb.logSearch).mock.calls[0][0];
    expect(saved.officerId).toBe('actual-officer');
    expect(saved.logId).toBeTruthy();
    expect(onResults).toHaveBeenCalledWith([], 'data:image/jpeg;base64,AAAA', 'Image analysis', null, saved.logId);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
