import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startDemoSimulation, stopDemoSimulation, generateRandomDetection, DEMO_POIS, DEMO_CAMERAS, isSimulationRunning } from './demoSimulation';

describe('Local surveillance simulation', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, 'log').mockImplementation(() => {}); });
  afterEach(() => { stopDemoSimulation(); vi.useRealTimers(); vi.restoreAllMocks(); });
  it('keeps the existing first-event and recurring timing', () => {
    const callback = vi.fn(); startDemoSimulation(25000, callback);
    vi.advanceTimersByTime(7999); expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(callback).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(17000); expect(callback).toHaveBeenCalledTimes(2);
  });
  it('cancels the initial event and recurring events when stopped', () => {
    const callback = vi.fn(); startDemoSimulation(25000, callback);
    vi.advanceTimersByTime(4000); stopDemoSimulation();
    vi.advanceTimersByTime(60000);
    expect(callback).not.toHaveBeenCalled(); expect(isSimulationRunning()).toBe(false);
  });
  it('uses matching local fictional portraits rather than unrelated external snapshots', () => {
    const event = generateRandomDetection();
    expect(event.detection.snapshotUrl).toBe(event.poi.imageUrl);
    expect(event.detection.metadata).toMatchObject({ demo: true, syntheticPortrait: true });
    expect(DEMO_POIS.every(poi => poi.imageUrl?.startsWith('/demo/subject-'))).toBe(true);
    expect(DEMO_POIS.every(poi => poi.name.startsWith('Demo Subject'))).toBe(true);
    expect(DEMO_CAMERAS.every(camera => camera.coordinates.lat > 0 && camera.coordinates.lng > 0)).toBe(true);
    expect(generateRandomDetection().alert.id).not.toBe(event.alert.id);
  });
});
