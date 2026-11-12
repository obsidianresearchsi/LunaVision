import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFrom, mockRpc, mockStorage } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockStorage: {
    from: vi.fn(() => ({
      upload: vi.fn().mockResolvedValue({ error: null }),
      remove: vi.fn().mockResolvedValue({ error: null }),
      createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://example.com/signed.jpg' }, error: null }),
    })),
  },
}));

vi.mock('../services/supabase', () => ({
  workspaceEnabled: true,
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
    storage: mockStorage,
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1', email: 'admin@agency.gov.ng' } }, error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok-ag-1' } }, error: null }),
    },
  },
}));

function makeChain(rows: any[] = [], singleRow: any = null) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    not: () => chain,
    gte: () => chain,
    order: () => chain,
    limit: () => chain,
    range: () => chain,
    ilike: () => chain,
    maybeSingle: () => Promise.resolve({ data: singleRow, error: null }),
    single: () => Promise.resolve({ data: singleRow, error: null }),
    insert: () => Promise.resolve({ error: null }),
    then: (resolve: any, reject?: any) => Promise.resolve({ data: rows, count: rows.length, error: null }).then(resolve, reject),
  };
  return chain;
}

describe('Video Intelligence UI Workflows', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('CameraControlCenter saves per-camera capabilities, thresholds, and zones via lv_save_camera_intel', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'lv_cameras') {
        return makeChain([{ id: 'cam-1', name: 'North Gate', location: 'Entrance', playback_url: 'https://example.com/cam1.mp4' }]);
      }
      if (table === 'lv_camera_intel_settings') {
        return makeChain([], {
          revision: 2,
          settings: {
            capabilities: { people_detection: { enabled: true, sensitivity: 'medium' }, anpr: { enabled: false, sensitivity: 'high' } },
            zones: [],
            thresholds: { crowd_max: 12, occupancy_max: 30, loiter_seconds: 25, stationary_seconds: 60, abandoned_seconds: 30, alert_cooldown_seconds: 60 },
            schedule: { enabled: false, days: [1, 2, 3, 4, 5], start: '00:00', end: '23:59' },
            notify: { categories: ['intrusion', 'crowd'] },
          },
        });
      }
      return makeChain();
    });

    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'lv_workspace_feature_map') {
        return Promise.resolve({
          data: { people_analytics: true, vehicle_analytics: true, advanced_detection: true, anpr: false },
          error: null,
        });
      }
      if (fn === 'lv_save_camera_intel') {
        return Promise.resolve({ data: 3, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const { CameraControlCenter } = await import('./CameraControlCenter');
    await act(async () => {
      root.render(<CameraControlCenter workspaceId="ws-biz" agency={false} role="admin" />);
    });

    expect(host.textContent).toContain('North Gate — Entrance');
    // ANPR should not be rendered for business workspace
    expect(host.textContent).not.toContain('Automatic Number Plate Recognition (ANPR)');

    const saveBtn = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      b.textContent?.includes('Save camera settings'),
    )!;
    expect(saveBtn).toBeTruthy();
    await act(async () => {
      saveBtn.click();
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'lv_save_camera_intel',
      expect.objectContaining({
        target: 'ws-biz',
        camera: 'cam-1',
        expected_revision: 2,
      }),
    );
    expect(host.textContent).toContain('revision #3');
  });

  it('VehicleRegistry bulk-imports CSV data via lv_import_registry and searches records', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'lv_vehicle_registry') {
        return makeChain([
          {
            id: 'reg-1',
            plate: 'KJA492AX',
            make: 'Toyota',
            model: 'Corolla',
            colour: 'Silver',
            vehicle_type: 'Car',
            vehicle_year: 2021,
            registration_status: 'registered',
            notes: '',
            source_name: 'FRSC',
            created_at: '2026-11-11T10:00:00Z',
            updated_at: '2026-11-11T10:00:00Z',
          },
        ]);
      }
      return makeChain([]);
    });

    mockRpc.mockResolvedValue({
      data: { import_id: 'imp-1', total: 1, inserted: 1, updated: 0, duplicates: 0, invalid: 0, errors: [] },
      error: null,
    });

    const { default: VehicleRegistry } = await import('./VehicleRegistry');
    await act(async () => {
      root.render(<VehicleRegistry workspaceId="ws-ag" role="supervisor" />);
    });

    expect(host.textContent).toContain('KJA492AX');
    expect(host.textContent).toContain('Toyota Corolla');

    // Simulate CSV upload
    const fileInput = host.querySelector('input[type="file"]') as HTMLInputElement;
    const csvFile = new File(['plate,make,model,year,registration_status\nABJ 123 ZZ,Honda,Civic,2022,registered'], 'batch.csv', {
      type: 'text/csv',
    });
    // Polyfill file.text() cleanly in jsdom if needed
    if (typeof csvFile.text !== 'function') {
      (csvFile as any).text = async () => 'plate,make,model,year,registration_status\nABJ 123 ZZ,Honda,Civic,2022,registered';
    }
    await act(async () => {
      Object.defineProperty(fileInput, 'files', { value: [csvFile], configurable: true });
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(host.textContent).toContain('Ready to import 1 records');
    const importBtn = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      b.textContent?.includes('Import & validate batch'),
    )!;
    await act(async () => {
      importBtn.click();
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'lv_import_registry',
      expect.objectContaining({
        target: 'ws-ag',
        file_name: 'batch.csv',
      }),
    );
  });

  it('WorkspaceAccess exposes Super Admin feature toggles and 5 personnel roles', async () => {
    mockFrom.mockReturnValue(makeChain([]));
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'lv_workspace_feature_map') {
        return Promise.resolve({
          data: {
            people_analytics: true,
            vehicle_analytics: true,
            advanced_detection: true,
            anpr: true,
            vehicle_registry: true,
            security_intelligence: true,
            business_intelligence: false,
          },
          error: null,
        });
      }
      if (fn === 'lv_workspace_staff') {
        return Promise.resolve({ data: [{ user_id: 'u1', email: 'chief@agency.gov.ng', role: 'owner' }], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const { default: WorkspaceAccess } = await import('./WorkspaceAccess');
    await act(async () => {
      root.render(
        <WorkspaceAccess
          workspace={{ id: 'ws-ag', name: 'Lagos Command', kind: 'agency', active: true, entitlement: 'Full' }}
          platform={true}
          role="owner"
          onUpdated={async () => {}}
        />,
      );
    });

    expect(host.textContent).toContain('Organization Feature Entitlements');
    const roleOptions = Array.from(host.querySelectorAll('select[name="role"] option')).map((o) => (o as HTMLOptionElement).value);
    expect(roleOptions).toEqual(['member', 'viewer', 'investigator', 'supervisor', 'admin', 'revoke']);

    const enabledButtons = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter(
      (b) => b.textContent?.trim() === 'Enabled',
    );
    expect(enabledButtons.length).toBeGreaterThan(0);
    await act(async () => {
      enabledButtons[0].click();
    });
    expect(mockRpc).toHaveBeenCalledWith(
      'lv_set_workspace_feature',
      expect.objectContaining({
        target: 'ws-ag',
        is_enabled: false,
      }),
    );
  });

  it('SubjectEnrollmentCenter displays audit history and migrates criminal CSV + mugshots into Face++', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        face_token: 'ftok_afis_1042',
        faceset_outer_id: 'lv_wsag',
        face_indexed: true,
        quality_score: 90.2,
      }),
    );
    globalThis.fetch = fetchMock as any;

    mockFrom.mockImplementation((table: string) => {
      if (table === 'lv_agency_subjects') {
        return makeChain([
          {
            id: 'sub-1',
            subject_code: 'AFIS-1001',
            full_name: 'Chinedu Okafor',
            aliases: 'Chinedu',
            date_of_birth: '1988-02-01',
            gender: 'Male',
            nationality: 'Nigerian',
            category: 'wanted',
            threat_level: 'high',
            offense_summary: 'Trans-border smuggling',
            warrant_reference: 'WR-10',
            case_reference: 'CR-10',
            national_id: '',
            last_known_location: 'Seme Border',
            physical_marks: '',
            notes: '',
            status: 'active',
            minimum_clearance: 0,
            primary_photo_path: null,
            face_token: 'ftok-existing',
            face_indexed: true,
            source_name: 'Agency Dossier',
            created_at: '2026-11-11T10:00:00Z',
            created_by_label: 'inspector@agency.gov.ng',
          },
        ]);
      }
      if (table === 'lv_face_search_history') {
        return makeChain([
          {
            id: 'hist-1',
            actor_label: 'inspector@agency.gov.ng',
            search_mode: 'faceset_1n',
            probe_snapshot_path: null,
            top_confidence: 87.4,
            result_count: 1,
            results: [
              { subject_id: 'sub-1', subject_code: 'AFIS-1001', full_name: 'Chinedu Okafor', confidence: 87.4, band: 'high' },
            ],
            telemetry: {},
            case_reference: 'INV-2026-88',
            notes: 'Gate 2 camera match',
            created_at: '2026-11-11T10:05:00Z',
          },
        ]);
      }
      return makeChain([]);
    });

    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'lv_start_subject_migration') return Promise.resolve({ data: 'mig-job-1', error: null });
      if (fn === 'lv_upsert_agency_subject') return Promise.resolve({ data: 'sub-new-1', error: null });
      return Promise.resolve({ data: null, error: null });
    });

    try {
      const { default: SubjectEnrollmentCenter } = await import('./SubjectEnrollmentCenter');
      await act(async () => {
        root.render(<SubjectEnrollmentCenter workspaceId="ws-ag" role="investigator" initialTab="history" />);
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(host.textContent).toContain('Face search');
      expect(host.textContent).toContain('INV-2026-88');
      expect(host.textContent).toContain('87.4%');

      const migBtn = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
        b.textContent?.includes('Bulk Data & Photo Migration'),
      )!;
      await act(async () => {
        migBtn.click();
      });

      const fileInputs = host.querySelectorAll<HTMLInputElement>('input[type="file"]');
      const csvFile = new File(
        [
          'subject_code,full_name,category,threat_level,offense_summary,warrant_reference,case_reference,photo_filename\nAFIS-1042,Musa Danladi,wanted,high,Armed robbery,WR-44,CR-88,AFIS-1042.jpg',
        ],
        'criminal_export.csv',
        { type: 'text/csv' },
      );
      const photoFile = new File([new Uint8Array(64).fill(7)], 'AFIS-1042.jpg', { type: 'image/jpeg' });

      Object.defineProperty(fileInputs[0], 'files', { value: [csvFile], configurable: true });
      await act(async () => {
        fileInputs[0].dispatchEvent(new Event('change', { bubbles: true }));
      });

      Object.defineProperty(fileInputs[1], 'files', { value: [photoFile], configurable: true });
      await act(async () => {
        fileInputs[1].dispatchEvent(new Event('change', { bubbles: true }));
      });
      await act(async () => {
        await Promise.resolve();
      });

      const form = host.querySelector('form')!;
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      for (let i = 0; i < 8; i++) {
        await act(async () => {
          await Promise.resolve();
        });
      }

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/face-intelligence',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(mockRpc).toHaveBeenCalledWith(
        'lv_start_subject_migration',
        expect.objectContaining({ target: 'ws-ag', total: 1 }),
      );
      expect(mockRpc).toHaveBeenCalledWith(
        'lv_upsert_agency_subject',
        expect.objectContaining({
          target: 'ws-ag',
          entry: expect.objectContaining({
            subject_code: 'AFIS-1042',
            full_name: 'Musa Danladi',
            migration_id: 'mig-job-1',
          }),
          photos: [
            expect.objectContaining({
              face_token: 'ftok_afis_1042',
              face_indexed: true,
            }),
          ],
        }),
      );
      expect(mockRpc).toHaveBeenCalledWith(
        'lv_update_subject_migration',
        expect.objectContaining({ target_migration: 'mig-job-1', next_status: 'completed', indexed: 1 }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('VehicleWatchlist bulk migrates CSV rows and matched photos via lv_import_watchlist', async () => {
    mockFrom.mockImplementation(() => makeChain([]));
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'lv_import_watchlist') {
        return Promise.resolve({
          data: { inserted: 1, updated: 0, duplicates: 0, invalid: 0, errors: [] },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const { default: VehicleWatchlist } = await import('./VehicleWatchlist');
    await act(async () => {
      root.render(<VehicleWatchlist workspaceId="ws-ag" role="investigator" />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const summaries = Array.from(host.querySelectorAll('summary'));
    const bulkSummary = summaries.find((s) => s.textContent?.includes('Bulk Migrate Plate Watchlist'))!;
    expect(bulkSummary).toBeTruthy();

    const bulkDetails = bulkSummary.closest('details')!;
    bulkDetails.open = true;

    const fileInputs = bulkDetails.querySelectorAll<HTMLInputElement>('input[type="file"]');
    const wlCsv = new File(
      ['plate,category,case_reference,make,model,colour,status,photo_filename\nLAG-123-AA,stolen,CR-2026-101,Toyota,Hilux,White,active,LAG123AA.jpg'],
      'hotlist.csv',
      { type: 'text/csv' },
    );
    const carPhoto = new File([new Uint8Array(64).fill(5)], 'LAG123AA.jpg', { type: 'image/jpeg' });

    Object.defineProperty(fileInputs[0], 'files', { value: [wlCsv], configurable: true });
    await act(async () => {
      fileInputs[0].dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 25));
    });
    Object.defineProperty(fileInputs[1], 'files', { value: [carPhoto], configurable: true });
    await act(async () => {
      fileInputs[1].dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    const migForm = bulkDetails.querySelector('form')!;
    await act(async () => {
      migForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    expect(mockRpc).toHaveBeenCalledWith(
      'lv_import_watchlist',
      expect.objectContaining({
        target: 'ws-ag',
        file_name: 'hotlist.csv',
        entries: [
          expect.objectContaining({
            plate: 'LAG-123-AA',
            category: 'stolen',
            case_reference: 'CR-2026-101',
          }),
        ],
      }),
    );
  });

  it('SubjectEnrollmentCenter books a convict/subject dossier with mugshot into Face++ and shows face_token receipt', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        face_token: 'ftok_convict_901',
        faceset_outer_id: 'lv_wsag',
        face_indexed: true,
        quality_score: 94.6,
      }),
    );
    globalThis.fetch = fetchMock as any;

    mockFrom.mockImplementation(() => makeChain([]));
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'lv_upsert_agency_subject') return Promise.resolve({ data: { id: 'sub-convict-1' }, error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const onOpenFaceSearch = vi.fn();
    try {
      const { default: SubjectEnrollmentCenter } = await import('./SubjectEnrollmentCenter');
      await act(async () => {
        root.render(
          <SubjectEnrollmentCenter
            workspaceId="ws-ag"
            role="investigator"
            initialTab="enroll"
            onOpenFaceSearch={onOpenFaceSearch}
          />,
        );
      });
      await act(async () => {
        await Promise.resolve();
      });

      const codeInput = host.querySelector<HTMLInputElement>('input[name="subject_code"]')!;
      expect(codeInput.value).toMatch(/^AFIS-\d{4}-[A-HJ-NP-Z2-9]{6}$/);
      const firstCode = codeInput.value;

      const regenBtn = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
        (b) => b.textContent?.trim() === 'Regenerate',
      )!;
      expect(regenBtn).toBeTruthy();
      await act(async () => {
        regenBtn.click();
      });
      const updatedCodeInput = host.querySelector<HTMLInputElement>('input[name="subject_code"]')!;
      expect(updatedCodeInput.value).toMatch(/^AFIS-\d{4}-[A-HJ-NP-Z2-9]{6}$/);
      expect(updatedCodeInput.value).not.toBe(firstCode);
      const submittedCode = updatedCodeInput.value;

      const nameInput = host.querySelector<HTMLInputElement>('input[name="full_name"]')!;
      const offenseInput = host.querySelector<HTMLTextAreaElement>('textarea[name="offense_summary"]')!;
      const locInput = host.querySelector<HTMLInputElement>('input[name="last_known_location"]')!;
      nameInput.value = 'Suleiman Bello';
      offenseInput.value = 'Convicted armed hijacking & escape';
      locInput.value = 'Lagos';

      const mugshotInput = host.querySelector<HTMLInputElement>('input[name="mugshots"]')!;
      const mugFile = new File([new Uint8Array(64).fill(9)], 'bello_frontal.jpg', { type: 'image/jpeg' });
      Object.defineProperty(mugshotInput, 'files', { value: [mugFile], configurable: true });
      await act(async () => {
        mugshotInput.dispatchEvent(new Event('change', { bubbles: true }));
      });

      const form = host.querySelector('form')!;
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      for (let i = 0; i < 8; i++) {
        await act(async () => {
          await Promise.resolve();
        });
      }

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/face-intelligence',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(mockRpc).toHaveBeenCalledWith(
        'lv_upsert_agency_subject',
        expect.objectContaining({
          target: 'ws-ag',
          entry: expect.objectContaining({
            subject_code: submittedCode,
            full_name: 'Suleiman Bello',
            offense_summary: 'Convicted armed hijacking & escape',
            last_known_location: 'Lagos',
          }),
          photos: [
            expect.objectContaining({
              face_token: 'ftok_convict_901',
              face_indexed: true,
              angle_label: 'frontal',
              is_primary: true,
            }),
          ],
        }),
      );
      expect(host.textContent).toContain('Enrolled on FaceDB & Dossier Database: Suleiman Bello');
      expect(host.textContent).toContain(submittedCode);
      expect(host.textContent).toContain('ftok_convict_901');
      const nextCodeInput = host.querySelector<HTMLInputElement>('input[name="subject_code"]')!;
      expect(nextCodeInput.value).toMatch(/^AFIS-\d{4}-[A-HJ-NP-Z2-9]{6}$/);
      expect(nextCodeInput.value).not.toBe(submittedCode);

      const searchBtn = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
        b.textContent?.includes('Face search'),
      )!;
      expect(searchBtn).toBeTruthy();
      await act(async () => {
        searchBtn.click();
      });
      expect(onOpenFaceSearch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('SubjectEnrollmentCenter completes dossier booking when Face++ FaceSet returns face_indexed=false fallback', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      Response.json({
        face_token: 'ftok_fb_02',
        faceset_outer_id: 'lv_wsag',
        face_indexed: false,
        index_warning: 'INTERNAL_ERROR',
        quality_score: 88.5,
      }),
    ) as any;

    mockFrom.mockImplementation(() => makeChain([]));
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'lv_upsert_agency_subject') return Promise.resolve({ data: { id: 'sub-convict-2' }, error: null });
      return Promise.resolve({ data: null, error: null });
    });

    try {
      const { default: SubjectEnrollmentCenter } = await import('./SubjectEnrollmentCenter');
      await act(async () => {
        root.render(<SubjectEnrollmentCenter workspaceId="ws-ag" role="investigator" initialTab="enroll" />);
      });
      await act(async () => {
        await Promise.resolve();
      });

      host.querySelector<HTMLInputElement>('input[name="full_name"]')!.value = 'Garba Danladi';
      const mugshotInput = host.querySelector<HTMLInputElement>('input[name="mugshots"]')!;
      const mugFile = new File([new Uint8Array(64).fill(5)], 'garba.jpg', { type: 'image/jpeg' });
      Object.defineProperty(mugshotInput, 'files', { value: [mugFile], configurable: true });
      await act(async () => {
        mugshotInput.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await act(async () => {
        host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      for (let i = 0; i < 8; i++) {
        await act(async () => {
          await Promise.resolve();
        });
      }

      expect(mockRpc).toHaveBeenCalledWith(
        'lv_upsert_agency_subject',
        expect.objectContaining({
          target: 'ws-ag',
          photos: [
            expect.objectContaining({
              face_token: 'ftok_fb_02',
              face_indexed: false,
            }),
          ],
        }),
      );
      expect(host.textContent).toContain('Direct comparison fallback active (INTERNAL_ERROR)');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('SubjectEnrollmentCenter explains permission requirements clearly when role is member', async () => {
    mockFrom.mockImplementation(() => makeChain([]));
    const { default: SubjectEnrollmentCenter } = await import('./SubjectEnrollmentCenter');
    await act(async () => {
      root.render(<SubjectEnrollmentCenter workspaceId="ws-ag" role="member" initialTab="enroll" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.textContent).toContain('Your current account role ("member") cannot enroll biometric subjects.');
  });

  it('WorkspaceAccess separates Officer management (paginated + sidebar pages) from Audit Logs console', async () => {
    const manyStaff = Array.from({ length: 8 }, (_, idx) => ({
      user_id: `u-${idx + 1}`,
      email: `officer${idx + 1}@agency.gov.ng`,
      role: idx === 0 ? 'owner' : 'investigator',
      clearance: idx === 0 ? 3 : 1,
      allowed_modules: ['command', 'gallery'],
    }));
    const manyLogs = Array.from({ length: 15 }, (_, idx) => ({
      id: idx + 1,
      actor_id: 'u-1',
      subject_id: 'u-2',
      action: idx % 2 === 0 ? 'subject_enrolled' : 'staff_access_updated',
      details: { target_role: 'investigator' },
      created_at: new Date(Date.UTC(2026, 10, 12, 10, idx)).toISOString(),
    }));

    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'lv_workspace_staff_access' || fn === 'lv_workspace_staff') {
        return Promise.resolve({ data: manyStaff, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'lv_workspace_activity') return makeChain(manyLogs);
      return makeChain([]);
    });

    const { default: WorkspaceAccess } = await import('./WorkspaceAccess');

    // Audit mode: detailed paginated logs ONLY, no account creation
    await act(async () => {
      root.render(
        <WorkspaceAccess
          workspace={{ id: 'ws-ag', name: 'Lagos Command', kind: 'agency', active: true, entitlement: 'Full' }}
          platform={false}
          role="admin"
          viewMode="audit"
          onUpdated={async () => {}}
        />,
      );
    });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    expect(host.textContent).toContain('Access & Security Audit Logs');
    expect(host.textContent).toContain('Total audit records15');
    expect(host.textContent).toContain('Page 1 of 2');
    expect(host.textContent).not.toContain('Officer Account Provisioning & Page Access');

    // Officer management mode: paginated personnel + sidebar page module checkboxes (excluding admin pages)
    await act(async () => {
      root.render(
        <WorkspaceAccess
          workspace={{ id: 'ws-ag', name: 'Lagos Command', kind: 'agency', active: true, entitlement: 'Full' }}
          platform={false}
          role="admin"
          viewMode="officers"
          onUpdated={async () => {}}
        />,
      );
    });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    expect(host.textContent).toContain('Officer Account Provisioning & Page Access');
    expect(host.textContent).toContain('Personnel directory (8)');
    expect(host.textContent).toContain('Page 1 of 2');
    expect(host.textContent).toContain('Face search');
    expect(host.textContent).not.toContain('Access & Security Audit Logs');
    const modCheckboxes = Array.from(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="modules"]')).map((c) => c.value);
    expect(modCheckboxes).toContain('command');
    expect(modCheckboxes).toContain('gallery');
    expect(modCheckboxes).not.toContain('access');
    expect(modCheckboxes).not.toContain('officers');
    expect(modCheckboxes).not.toContain('configuration');
    expect(modCheckboxes).not.toContain('integrations');

    // Clicking Edit access syncs existing role & clearance instead of downgrading to member/0
    const editButtons = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent?.trim() === 'Edit access');
    await act(async () => {
      editButtons[1].click();
    });
    expect(host.querySelector<HTMLSelectElement>('select[name="role"]')?.value).toBe('investigator');
    expect(host.querySelector<HTMLSelectElement>('select[name="clearance"]')?.value).toBe('1');
  });
});

