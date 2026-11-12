import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlatformUpdate from './PlatformUpdate';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  localStorage.clear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); vi.restoreAllMocks(); vi.useRealTimers();
});
const progress = () => Number(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'));
const render = async () => { await act(async () => root.render(<PlatformUpdate />)); };

describe('Platform update presentation', () => {
  it('takes five minutes to reach 99%, then remains there without completing', async () => {
    await render(); expect(progress()).toBe(0);
    await act(async () => vi.advanceTimersByTimeAsync(150000));
    expect(progress()).toBeGreaterThan(0); expect(progress()).toBeLessThan(99);
    await act(async () => vi.advanceTimersByTimeAsync(149000)); expect(progress()).toBeLessThan(99);
    await act(async () => vi.advanceTimersByTimeAsync(1000)); expect(progress()).toBe(99);
    await act(async () => vi.advanceTimersByTimeAsync(86400000)); expect(progress()).toBe(99);
    expect(host.textContent).toContain('Finalizing the update'); expect(vi.getTimerCount()).toBe(0);
  });
  it('retains progress when navigating between pages or refreshing', async () => {
    await render(); await act(async () => vi.advanceTimersByTimeAsync(180000)); const saved = progress();
    await act(async () => root.unmount()); root = createRoot(host);
    history.replaceState(null, '', '/agency'); await render(); expect(progress()).toBe(saved);
    await act(async () => root.unmount()); root = createRoot(host);
    history.replaceState(null, '', '/business'); await render(); expect(progress()).toBe(saved);
    expect(host.querySelector('a,button,form')).toBeNull();
  });
  it('still advances when browser storage is unavailable and releases its timer on unmount', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage disabled'); });
    await render(); await act(async () => vi.advanceTimersByTimeAsync(60000)); expect(progress()).toBeGreaterThan(0);
    await act(async () => root.unmount()); expect(vi.getTimerCount()).toBe(0); root = createRoot(host);
  });
});
