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
vi.mock('../services/supabase', () => ({ supabase: { rpc } }));
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
    vi.useRealTimers();
  });

  async function click(label: string) {
    const button = [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === label);
    expect(button, label).toBeDefined();
    await act(async () => button!.click());
  }

  it('analyzes a live phone frame locally and releases the camera when stopped', async () => {
    const track = Object.assign(new EventTarget(), { stop: vi.fn() });
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    detect.mockResolvedValue([{ class: 'car', score: 0.95, bbox: [20, 20, 140, 100] }]);
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

    await act(async () => root.render(<VideoAnalysis workspaceId="agency" watchlistWorkspaceId="agency" />));
    await click('Phone camera');
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }));
    const video = host.querySelector('video')!;
    expect(video.srcObject).toBe(stream);
    Object.defineProperties(video, {
      readyState: { value: 2 }, videoWidth: { value: 1280 }, videoHeight: { value: 720 },
    });
    await act(async () => vi.waitFor(() => expect(recognize).toHaveBeenCalled()));
    expect(host.textContent).toContain('ABC123DE');
    expect(detect).toHaveBeenCalled();
    expect(recognize).toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('Live face recognition');
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
