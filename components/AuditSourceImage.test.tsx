import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AuditSourceImage } from './AuditSourceImage';
import { supabaseDb } from '../services/supabaseDb';
vi.mock('../services/supabaseDb', () => ({ supabaseDb: { getAuditImage: vi.fn() } }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
it('defers image retrieval until visible, then supports retry after a failed read', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  let notify!: (entries: { isIntersecting: boolean }[]) => void;
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: typeof notify) { notify = callback; } observe() {} disconnect() {} });
  vi.mocked(supabaseDb.getAuditImage).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce('data:image/png;base64,fixture');
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<AuditSourceImage logId="audit-original" alt="Saved evidence"/>));
    expect(supabaseDb.getAuditImage).not.toHaveBeenCalled();
    await act(async () => notify([{ isIntersecting: true }]));
    expect(host.textContent).toContain('Image unavailable');
    await act(async () => host.querySelector('button')!.click());
    expect(host.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,fixture');
    expect(supabaseDb.getAuditImage).toHaveBeenLastCalledWith('audit-original');
  } finally { await act(async () => root.unmount()); host.remove(); }
});
