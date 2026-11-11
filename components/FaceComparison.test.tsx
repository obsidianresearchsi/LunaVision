import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}));

vi.mock('../services/supabase', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
    },
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
      }),
    },
  },
}));

import FaceComparison from './FaceComparison';

describe('FaceComparison component', () => {
  let host: HTMLDivElement;
  let root: Root;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'session-jwt' } },
      error: null,
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('explains required configuration when VITE_FACE_COMPARISON_ENABLED is not enabled', async () => {
    vi.stubEnv('VITE_FACE_COMPARISON_ENABLED', 'false');
    await act(async () => {
      root.render(<FaceComparison workspaceId="ws-ag-1" />);
    });
    expect(host.textContent).toContain('VITE_FACE_COMPARISON_ENABLED=true');
  });

  it('performs 1:1 Face++ comparison and displays score with threshold badge', async () => {
    vi.stubEnv('VITE_FACE_COMPARISON_ENABLED', 'true');
    const mockFetch = vi.fn().mockResolvedValue(
      Response.json({ score: 86.4, threshold: 73.9 }),
    );
    globalThis.fetch = mockFetch as any;

    await act(async () => {
      root.render(<FaceComparison workspaceId="ws-ag-1" />);
    });

    const inputs = host.querySelectorAll<HTMLInputElement>('input[type="file"]');
    const refFile = new File([new Uint8Array(32).fill(1)], 'ref.jpg', { type: 'image/jpeg' });
    const candFile = new File([new Uint8Array(32).fill(2)], 'suspect.jpg', { type: 'image/jpeg' });

    Object.defineProperty(inputs[0], 'files', { value: [refFile], configurable: true });
    Object.defineProperty(inputs[1], 'files', { value: [candFile], configurable: true });

    const form = host.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/face-compare',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer session-jwt', 'X-Workspace-Id': 'ws-ag-1' },
      }),
    );
    expect(host.textContent).toContain('suspect.jpg');
    expect(host.textContent).toContain('86.4');
    expect(host.textContent).toContain('Above 1e-5 threshold');
  });

  it('completes gallery search with partial 422 errors and sorts valid scores highest first', async () => {
    vi.stubEnv('VITE_FACE_COMPARISON_ENABLED', 'true');
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ score: 54.2, threshold: 73.9 }))
      .mockResolvedValueOnce(Response.json({ error: 'No face was detected in the comparison photo.' }, { status: 422 }))
      .mockResolvedValueOnce(Response.json({ score: 91.8, threshold: 73.9 }));
    globalThis.fetch = mockFetch as any;

    await act(async () => {
      root.render(<FaceComparison workspaceId="ws-ag-1" gallery />);
    });

    const adhocBtn = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      b.textContent?.includes('1-vs-6 Ad-Hoc Photo Gallery'),
    )!;
    expect(adhocBtn).toBeTruthy();
    await act(async () => {
      adhocBtn.click();
    });

    const inputs = host.querySelectorAll<HTMLInputElement>('input[type="file"]');
    const refFile = new File([new Uint8Array(32).fill(1)], 'ref.jpg', { type: 'image/jpeg' });
    const g1 = new File([new Uint8Array(32).fill(2)], 'low-match.jpg', { type: 'image/jpeg' });
    const g2 = new File([new Uint8Array(32).fill(3)], 'blurry.jpg', { type: 'image/jpeg' });
    const g3 = new File([new Uint8Array(32).fill(4)], 'high-match.jpg', { type: 'image/jpeg' });

    Object.defineProperty(inputs[0], 'files', { value: [refFile], configurable: true });
    Object.defineProperty(inputs[1], 'files', { value: [g1, g2, g3], configurable: true });

    const form = host.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    const articles = Array.from(host.querySelectorAll('article')).map((a) => a.textContent || '');
    expect(articles.length).toBe(3);
    expect(articles[0]).toContain('high-match.jpg');
    expect(articles[0]).toContain('Above 1e-5 threshold');
    expect(articles[1]).toContain('low-match.jpg');
    expect(articles[1]).toContain('Below 1e-5 threshold');
    expect(articles[2]).toContain('blurry.jpg');
    expect(articles[2]).toContain('No face was detected in the comparison photo.');
  });

  it('runs 1:N Agency Database Search via /api/face-intelligence and displays matched criminal dossier', async () => {
    vi.stubEnv('VITE_FACE_COMPARISON_ENABLED', 'true');
    const mockFetch = vi.fn().mockResolvedValue(
      Response.json({
        search_id: 'log-1',
        faceset_outer_id: 'lv_wsag1',
        thresholds: { '1e-3': 62.3, '1e-4': 69.1, '1e-5': 73.9 },
        telemetry: { quality: 92.4, blur: 4.1, faces_in_probe: 1 },
        matches: [
          {
            subject_id: 'sub-44',
            subject_code: 'AFIS-044',
            full_name: 'Kolawole Adeyemi',
            aliases: 'Kola',
            category: 'wanted',
            threat_level: 'high',
            offense_summary: 'Armed hijacking syndicate',
            warrant_reference: 'WR-404',
            case_reference: 'CR-881',
            last_known_location: 'Apapa Gate',
            status: 'active',
            face_token: 'ftok-1',
            confidence: 89.3,
            band: 'high',
            photo_url: null,
          },
        ],
      }),
    );
    globalThis.fetch = mockFetch as any;

    await act(async () => {
      root.render(<FaceComparison workspaceId="ws-ag-1" gallery />);
    });

    const probeInput = host.querySelector<HTMLInputElement>('input[name="probe"]')!;
    const probeFile = new File([new Uint8Array(32).fill(9)], 'probe.jpg', { type: 'image/jpeg' });
    Object.defineProperty(probeInput, 'files', { value: [probeFile], configurable: true });

    const caseInput = host.querySelector<HTMLInputElement>('input[name="case_reference"]')!;
    caseInput.value = 'CR-881';

    const form = host.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/face-intelligence',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer session-jwt', 'X-Workspace-Id': 'ws-ag-1' },
      }),
    );
    expect(host.textContent).toContain('Kolawole Adeyemi');
    expect(host.textContent).toContain('Armed hijacking syndicate');
    expect(host.textContent).toContain('89.3');
  });

  it('previews uploaded photos aside immediately before search/comparison is submitted', async () => {
    vi.stubEnv('VITE_FACE_COMPARISON_ENABLED', 'true');
    const origCreateObjectURL = URL.createObjectURL;
    const origRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn((file: Blob) => `blob:preview-${(file as File).name || 'img'}`);
    URL.revokeObjectURL = vi.fn();

    try {
      await act(async () => {
        root.render(<FaceComparison workspaceId="ws-ag-1" gallery />);
      });

      const probeInput = host.querySelector<HTMLInputElement>('input[name="probe"]')!;
      const probeFile = new File([new Uint8Array(2048).fill(7)], 'gate-probe.jpg', { type: 'image/jpeg' });
      Object.defineProperty(probeInput, 'files', { value: [probeFile], configurable: true });
      await act(async () => {
        probeInput.dispatchEvent(new Event('change', { bubbles: true }));
      });

      const probeAside = host.querySelector<HTMLElement>('aside[aria-label="Uploaded probe preview"]')!;
      expect(probeAside).toBeTruthy();
      const probeImg = probeAside.querySelector<HTMLImageElement>('img')!;
      expect(probeImg?.getAttribute('src')).toBe('blob:preview-gate-probe.jpg');
      expect(probeAside.textContent).toContain('gate-probe.jpg');

      const removeBtn = Array.from(probeAside.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
        b.textContent?.includes('Remove photo'),
      )!;
      await act(async () => {
        removeBtn.click();
      });
      expect(probeAside.querySelector('img')).toBeNull();

      // Switch to 1-vs-6 Ad-Hoc Photo Gallery and verify aside previews for reference + gallery photos
      const adhocBtn = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
        b.textContent?.includes('1-vs-6 Ad-Hoc Photo Gallery'),
      )!;
      await act(async () => {
        adhocBtn.click();
      });

      const refInput = host.querySelector<HTMLInputElement>('input[name="reference"]')!;
      const candInput = host.querySelector<HTMLInputElement>('input[name="candidate"]')!;
      Object.defineProperty(refInput, 'files', {
        value: [new File([new Uint8Array(1024).fill(1)], 'ref-shot.jpg', { type: 'image/jpeg' })],
        configurable: true,
      });
      Object.defineProperty(candInput, 'files', {
        value: [
          new File([new Uint8Array(1024).fill(2)], 'cand-a.jpg', { type: 'image/jpeg' }),
          new File([new Uint8Array(1024).fill(3)], 'cand-b.jpg', { type: 'image/jpeg' }),
        ],
        configurable: true,
      });

      await act(async () => {
        refInput.dispatchEvent(new Event('change', { bubbles: true }));
        candInput.dispatchEvent(new Event('change', { bubbles: true }));
      });

      const adhocAside = host.querySelector<HTMLElement>('aside[aria-label="Uploaded comparison previews"]')!;
      const imgs = Array.from(adhocAside.querySelectorAll('img')).map((img) => img.getAttribute('src'));
      expect(imgs).toEqual(['blob:preview-ref-shot.jpg', 'blob:preview-cand-a.jpg', 'blob:preview-cand-b.jpg']);
    } finally {
      URL.createObjectURL = origCreateObjectURL;
      URL.revokeObjectURL = origRevokeObjectURL;
    }
  });
});

