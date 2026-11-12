import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFrom, mockStorage } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockStorage: {
    from: vi.fn(() => ({
      createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://example.test/mugshot.jpg' }, error: null }),
    })),
  },
}));

vi.mock('../services/supabase', () => ({
  supabase: {
    from: mockFrom,
    storage: mockStorage,
  },
}));

vi.mock('../services/mapConfig', () => ({
  basemap: { url: 'https://example.test/tiles', options: {} },
  commandBasemap: { url: 'https://example.test/tiles', options: {} },
}));

vi.mock('leaflet', () => {
  const makeLayer = () => ({
    clearLayers: vi.fn(),
    addTo: function () { return this; },
  });
  const makeMarker = () => {
    const m: any = {
      addTo: () => m,
      bindTooltip: () => m,
      on: () => m,
      getLatLng: () => ({ lat: 6.52, lng: 3.38 }),
    };
    return m;
  };
  return {
    default: {
      map: () => ({
        setView: vi.fn().mockReturnThis(),
        fitBounds: vi.fn().mockReturnThis(),
        remove: vi.fn(),
        invalidateSize: vi.fn(),
      }),
      tileLayer: () => ({ addTo: vi.fn().mockReturnThis(), on: vi.fn().mockReturnThis() }),
      layerGroup: makeLayer,
      circleMarker: makeMarker,
      latLngBounds: () => ({}),
      control: { layers: () => ({ addTo: vi.fn() }) },
    },
  };
});

function chain(rows: any[] = []) {
  const obj: any = {
    select: () => obj,
    eq: () => obj,
    order: () => obj,
    update: () => obj,
    single: () => Promise.resolve({ data: { id: 'ok' }, error: null }),
    then: (resolve: any, reject?: any) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
  };
  return obj;
}

describe('AgencyCommandMap direct preview, suspect dossiers, and pagination', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('paginates large map item lists, previews selected camera feed inline, and displays suspect dossier details', async () => {
    const manyCameras = Array.from({ length: 7 }, (_, i) => ({
      id: `cam-${i + 1}`,
      name: `Gate Camera ${i + 1}`,
      location: `Sector ${i + 1}`,
      latitude: 6.5 + i * 0.01,
      longitude: 3.35 + i * 0.01,
      playback_url: i === 0 ? 'https://cdn.example.test/gate1.mp4' : null,
      stream_type: 'video',
      source_configured: true,
    }));
    const subjects = [
      {
        id: 'sub-42',
        full_name: 'Tunde Balogun',
        subject_code: 'AFIS-2026-XYZ',
        category: 'wanted',
        threat_level: 'high',
        aliases: 'TBoy',
        offense_summary: 'Armed hijacking along Apapa corridor',
        warrant_reference: 'WR-991',
        case_reference: 'CASE-402',
        national_id: 'NIN-112233',
        last_known_location: 'Apapa Wharf [6.44880, 3.35900]',
        physical_marks: 'Scar on left cheek',
        notes: 'High priority interception',
        primary_photo_path: 'ws-ag/tunde.jpg',
        face_indexed: true,
        status: 'active',
      },
      {
        id: 'sub-43',
        full_name: 'Musa Danjuma',
        subject_code: 'AFIS-2026-MMM',
        category: 'suspect',
        threat_level: 'medium',
        last_known_location: 'Abuja Central',
        status: 'active',
      },
    ];
    const records = [
      { id: 'rec-1', title: 'Apapa Escort Log', status: 'in_review', latitude: 6.45, longitude: 3.36 },
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === 'lv_cameras') return chain(manyCameras);
      if (table === 'lv_agency_subjects') return chain(subjects);
      if (table === 'lv_records') return chain(records);
      return chain([]);
    });

    const openCam = vi.fn();
    const openSub = vi.fn();
    const { default: AgencyCommandMap } = await import('./AgencyCommandMap');
    await act(async () => {
      root.render(
        <AgencyCommandMap workspaceId="ws-ag" canManageCameras={true} openCamera={openCam} onOpenSubject={openSub} commandView />,
      );
    });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });

    // 7 cameras + 1 record + 2 subjects = 10 items -> 8 on page 1, 2 on page 2
    expect(host.textContent).toContain('Page 1 of 2 (10 total)');
    expect(host.textContent).toContain('Gate Camera 1');

    // Selecting Gate Camera 1 previews its live feed inline
    const cam1Btn = Array.from(host.querySelectorAll<HTMLButtonElement>('.lv-command-map-list button')).find((b) =>
      b.textContent?.includes('Gate Camera 1'),
    )!;
    await act(async () => { cam1Btn.click(); });
    const video = host.querySelector('video[aria-label="Live feed preview for Gate Camera 1"]') as HTMLVideoElement;
    expect(video).toBeTruthy();
    expect(video.getAttribute('src')).toBe('https://cdn.example.test/gate1.mp4');
    expect(host.textContent).toContain('Hide live preview');

    // Go to page 2 and select Tunde Balogun to see complete suspect dossier info
    const nextBtn = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === 'Next')!;
    await act(async () => { nextBtn.click(); });
    expect(host.textContent).toContain('Page 2 of 2 (10 total)');
    const subBtn = Array.from(host.querySelectorAll<HTMLButtonElement>('.lv-command-map-list button')).find((b) =>
      b.textContent?.includes('Tunde Balogun'),
    )!;
    await act(async () => { subBtn.click(); });
    for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });

    expect(host.textContent).toContain('AFIS-2026-XYZ');
    expect(host.textContent).toContain('Armed hijacking along Apapa corridor');
    expect(host.textContent).toContain('WR-991');
    expect(host.textContent).toContain('CASE-402');
    expect(host.textContent).toContain('NIN-112233');
    expect(host.querySelector('img[alt*="Tunde Balogun"]')?.getAttribute('src')).toBe('https://example.test/mugshot.jpg');
  });
});

