import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WatchlistPage } from './Watchlist';
import { SurveillanceDashboard } from './SurveillanceDashboard';
import { CameraStatus, POIPriority } from '../types';
import { addPOI, getPOIs, removePOI } from '../services/watchlistService';
import { startDemoSimulation, stopDemoSimulation } from '../services/demoSimulation';
import { getCameras } from '../services/cameraService';

vi.mock('../services/watchlistService', () => ({
  getPOIs: vi.fn(), addPOI: vi.fn(), removePOI: vi.fn(), updatePOI: vi.fn(),
  getDetectionCount: vi.fn().mockResolvedValue(1), getLastDetection: vi.fn().mockResolvedValue(null), getDetectionHistory: vi.fn().mockResolvedValue([])
}));
vi.mock('../services/cameraService', () => ({ getCameras: vi.fn().mockResolvedValue([
  { id: 'cam-1', name: 'Camera A', status: 'ONLINE', coordinates: { lat: 9, lng: 7 }, streamUrl: '', description: '', lastOnline: null, createdAt: '', updatedAt: '' }
]) }));
vi.mock('../services/detectionService', () => ({ getRecentDetections: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/demoSimulation', () => ({ startDemoSimulation: vi.fn(), stopDemoSimulation: vi.fn(), isSimulationRunning: vi.fn(() => false), getDemoCameras: vi.fn(() => []) }));
vi.mock('../components/AddPOIModal', () => ({ AddPOIModal: ({ isOpen, onSubmit }: any) => isOpen ? <button onClick={() => onSubmit({ faceToken: 'new-face', name: 'New subject' })}>Save POI fixture</button> : null }));
vi.mock('../components/CameraFeedCard', () => ({ CameraFeedCard: ({ camera, onExpand }: any) => <button onClick={onExpand}>Expand {camera.name}</button> }));
vi.mock('../components/CameraFeedModal', () => ({ CameraFeedModal: ({ onClose }: any) => <button onClick={onClose}>Close camera fixture</button> }));

const poi = { id: 'poi-1', faceToken: 'face-1', name: 'Subject A', imageUrl: null, priority: POIPriority.CRITICAL, caseId: 'case-real', isActive: true, createdAt: '2026-10-31', createdBy: 'officer-1' };
describe('Monitoring workflows', () => {
  let host: HTMLDivElement; let root: Root;
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(getPOIs).mockResolvedValue([poi]);
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.useRealTimers(); });
  const render = async (ui: React.ReactNode) => { await act(async () => root.render(ui)); };
  const click = async (text: string) => { const button = [...host.querySelectorAll('button')].find(node => node.textContent?.trim() === text)!; expect(button).toBeTruthy(); await act(async () => button.click()); };

  it('attributes new watchlist entries to the signed-in officer and keeps removal confirmation', async () => {
    const navigate = vi.fn();
    await render(<WatchlistPage currentOfficerId="signed-in-officer" onNavigateToCase={navigate}/>);
    await click('View case / case-real');
    expect(navigate).toHaveBeenCalledWith('case-real');
    await click('Add POI'); await click('Save POI fixture');
    expect(addPOI).toHaveBeenCalledWith({ faceToken: 'new-face', name: 'New subject' }, 'signed-in-officer');
    await click('Remove');
    expect(host.textContent).toContain('Remove from Watchlist?');
    expect(removePOI).not.toHaveBeenCalled();
    await click('Cancel');
    expect(removePOI).not.toHaveBeenCalled();
    await click('History'); expect(host.textContent).toContain('Detection History');
  });

  it('retains stored camera selection, layout changes, expansion, and explicit demo controls', async () => {
    vi.useFakeTimers();
    localStorage.setItem('surveillance_dashboard_selection', JSON.stringify({ layout: '2x2', selectedCameraIds: ['cam-1'] }));
    await render(<SurveillanceDashboard/>);
    await click('Expand Camera A'); await click('Close camera fixture');
    await click('3x3');
    expect(JSON.parse(localStorage.getItem('surveillance_dashboard_selection')!).layout).toBe('3x3');
    await click('Demo Mode'); expect(startDemoSimulation).toHaveBeenCalled();
    expect(host.textContent).toContain('Demo Mode Active');
    const callsBeforeRefresh = vi.mocked(getCameras).mock.calls.length;
    await act(async () => vi.advanceTimersByTime(30000));
    expect(getCameras).toHaveBeenCalledTimes(callsBeforeRefresh);
    await click('Stop Demo'); expect(stopDemoSimulation).toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('surveillance_dashboard_selection')!).layout).toBe('3x3');
    expect(host.textContent).toContain('Expand Camera A');
  });
});
