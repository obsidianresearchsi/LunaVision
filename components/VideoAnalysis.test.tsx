import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VideoAnalysis from './VideoAnalysis';

const { detect, recognize, rpc } = vi.hoisted(() => ({
  detect: vi.fn(),
  recognize: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('./CameraStream', () => ({
  CameraStream: ({ ref, src, muted }: React.ComponentProps<'video'>) => <video ref={ref} src={src} muted={muted} />,
}));
vi.mock('./VehicleWatchlist', () => ({ PlateWatchlistCheck: () => null }));
vi.mock('../services/supabase', () => ({
  supabase: { rpc, auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) } },
}));
vi.mock('@tensorflow/tfjs', () => ({ ready: async () => {}, getBackend: () => 'cpu' }));
vi.mock('@tensorflow-models/coco-ssd', () => ({ load: async () => ({ detect }) }));
vi.mock('tesseract.js', () => ({
  PSM: { SINGLE_LINE: '7' },
  createWorker: async () => ({ recognize, setParameters: async () => {}, terminate: async () => {} }),
}));

describe('Phone camera analysis', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let originalDevices: PropertyDescriptor | undefined;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    originalDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    if (originalDevices) Object.defineProperty(navigator, 'mediaDevices', originalDevices);
    else Reflect.deleteProperty(navigator, 'mediaDevices');
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function click(label: string) {
    const button = [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === label);
    expect(button, label).toBeDefined();
    await act(async () => button!.click());
  }

  it.each([false, true])('analyzes phone frames at a fixed timestamp with face access=%s', async allowPhoneFaceSearch => {
    vi.stubEnv('VITE_FACE_COMPARISON_ENABLED', 'true');
    const fetchFrame = vi.fn(async () => Response.json({ matches: [
      { subject_id: 'candidate-1', full_name: 'Test Candidate', band: 'high', confidence: 93 },
      { subject_id: 'candidate-2', full_name: 'Low Confidence Candidate', band: 'investigative', confidence: 61 },
    ] }));
    vi.stubGlobal('fetch', fetchFrame);
    const track = Object.assign(new EventTarget(), { stop: vi.fn() });
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    detect.mockResolvedValue([
      { class: 'car', score: 0.95, bbox: [20, 20, 140, 100] },
      { class: 'person', score: 0.95, bbox: [160, 20, 40, 110] },
    ]);
    recognize.mockResolvedValue({ data: { text: 'ABC123DE', confidence: 95 } });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const context = {
      drawImage: vi.fn(),
      getImageData: (_x: number, _y: number, width: number, height: number) => ({
        width, height, data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation((() => context) as unknown as typeof HTMLCanvasElement.prototype.getContext);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AA==');
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation(callback => callback(new Blob(['sample frame'], { type: 'image/jpeg' })));

    await act(async () => root.render(<VideoAnalysis workspaceId="agency" watchlistWorkspaceId="agency" allowPhoneFaceSearch={allowPhoneFaceSearch} />));
    await click('Phone camera');
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }));
    const video = host.querySelector('video')!;
    expect(video.srcObject).toBe(stream);
    Object.defineProperties(video, {
      readyState: { value: 2 }, paused: { value: false },
      videoWidth: { value: 1280 }, videoHeight: { value: 720 }, currentTime: { value: 0 },
    });
    await act(async () => vi.waitFor(() => expect(detect.mock.calls.length).toBeGreaterThanOrEqual(2)));
    expect(host.textContent).toContain('Live object detection is active.');
    expect(host.textContent).toContain('ABC123DE');
    expect(detect).toHaveBeenCalled();
    expect(recognize).toHaveBeenCalled();
    expect(fetchFrame).not.toHaveBeenCalled();
    if (allowPhoneFaceSearch) {
      await click('Start live face search');
      await act(async () => vi.waitFor(() => expect(fetchFrame).toHaveBeenCalledOnce()));
      expect(fetchFrame).toHaveBeenCalledWith('/api/face-intelligence', expect.objectContaining({
        headers: { Authorization: 'Bearer test-token', 'X-Workspace-Id': 'agency' },
        body: expect.any(FormData),
      }));
      expect(host.textContent).toContain('Test Candidate');
      expect(host.textContent).not.toContain('Low Confidence Candidate');
      await click('Stop live face search');
      expect(host.textContent).not.toContain('Test Candidate');
    } else {
      expect(host.textContent).not.toContain('Start live face search');
    }
    expect(rpc).not.toHaveBeenCalled();
    await click('Stop phone camera');
    expect(track.stop).toHaveBeenCalledOnce();
    expect(host.querySelector('video')).toBeNull();
  });

  it('releases a permission request that returns after cancellation', async () => {
    const stop = vi.fn();
    let grant!: (stream: unknown) => void;
    const getUserMedia = vi.fn(() => new Promise(resolve => { grant = resolve; }));
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    await act(async () => root.render(<VideoAnalysis workspaceId="agency" />));
    await click('Phone camera');
    await click('Cancel camera request');
    await act(async () => grant({ getTracks: () => [{ stop }] }));
    expect(stop).toHaveBeenCalledOnce();
    expect(host.querySelector('video')).toBeNull();
  });
});
