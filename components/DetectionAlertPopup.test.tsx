import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DetectionAlertPopup } from './DetectionAlertPopup';
import { AlertStatus, POIPriority } from '../types';

const alert = { id: 'demo-alert-1', detectionId: 'detection-1', poiId: 'demo-poi-1', cameraId: 'demo-cam-1', status: AlertStatus.UNREAD, createdAt: '2026-11-01T12:00:00Z', cameraName: 'Abuja / Entry Plaza',
  poi: { id: 'demo-poi-1', faceToken: 'token-1', name: 'Demo Subject 01', imageUrl: '/demo/subject-01.jpg', priority: POIPriority.CRITICAL, isActive: true, createdAt: '2026-11-01', createdBy: 'demo' },
  detection: { id: 'detection-1', cameraId: 'demo-cam-1', poiId: 'demo-poi-1', snapshotUrl: '/demo/subject-01.jpg', confidence: .924, boundingBox: null, detectedAt: '2026-11-01', metadata: { demo: true } }
};
describe('Detection alert presentation and controls', () => {
  let root: Root; let host: HTMLDivElement;
  beforeEach(() => { vi.useFakeTimers(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
  const render = async (close: () => void, props = {}) => { await act(async () => root.render(<DetectionAlertPopup alert={alert} onClose={close} playSound={false} {...props}/>)); };
  it('clearly labels fictional imagery and preserves every action callback', async () => {
    const close = vi.fn(), feed = vi.fn(), poi = vi.fn(), link = vi.fn();
    await render(close, { onViewFeed: feed, onViewPOI: poi, onLinkToCase: link });
    expect(document.body.textContent).toContain('SIMULATION EVENT / FICTIONAL PROFILE');
    expect(document.body.textContent).toContain('92.4');
    expect(document.body.querySelectorAll('img')).toHaveLength(2);
    expect([...document.body.querySelectorAll('img')].every(image => image.getAttribute('src') === '/demo/subject-01.jpg')).toBe(true);
    for (const label of ['View Feed', 'View POI', 'Link Case']) {
      await act(async () => [...document.body.querySelectorAll('button')].find(button => button.textContent?.trim() === label)!.click());
    }
    expect(feed).toHaveBeenCalledWith(alert.cameraId); expect(poi).toHaveBeenCalledWith(alert.poiId); expect(link).toHaveBeenCalledWith(alert.id);
    await act(async () => document.body.querySelector<HTMLButtonElement>('[aria-label="Dismiss detection alert"]')!.click()); expect(close).toHaveBeenCalledOnce();
  });
  it('dismisses at ten seconds even when the parent supplies a new callback', async () => {
    const first = vi.fn(), latest = vi.fn(); await render(first);
    await act(async () => vi.advanceTimersByTime(4000));
    await render(latest);
    await act(async () => vi.advanceTimersByTime(5999)); expect(latest).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1)); expect(latest).toHaveBeenCalledOnce(); expect(first).not.toHaveBeenCalled();
  });
});

