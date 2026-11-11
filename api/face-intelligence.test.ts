// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreateClient, mockRpc, mockSignedUrl, mockDownload } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockRpc: vi.fn(),
  mockSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.example/subject.jpg' }, error: null }),
  mockDownload: vi.fn().mockResolvedValue({
    data: new Blob([new Uint8Array(48).fill(7)], { type: 'image/jpeg' }),
    error: null,
  }),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: mockCreateClient,
}));

import { handleFaceIntelligence } from './face-intelligence';

const WORKSPACE_ID = '10000000-0000-4000-8000-000000000001';
const OUTER_ID = 'lv_10000000000040008000000000000001';

function makeEnv(extra: Record<string, string | undefined> = {}) {
  return {
    SUPABASE_URL: 'https://proj.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    FACEPP_API_KEY: 'facepp-key',
    FACEPP_API_SECRET: 'facepp-secret',
    FACEPP_REGION: 'US',
    ...extra,
  };
}

function setupSupabaseMock({
  role = 'investigator',
  isMember = true,
  isAgency = true,
  featureMap = { biometric_enrollment: true, face_search: true },
  subjects = [] as any[],
  photos = [] as any[],
}: {
  role?: string;
  isMember?: boolean;
  isAgency?: boolean;
  featureMap?: Record<string, boolean>;
  subjects?: any[];
  photos?: any[];
} = {}) {
  mockRpc.mockImplementation((fn: string) => {
    if (fn === 'lv_workspace_feature_map') {
      return Promise.resolve({ data: featureMap, error: null });
    }
    if (fn === 'lv_log_face_search') {
      return Promise.resolve({ data: 'search-log-001', error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });

  mockCreateClient.mockImplementation(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
    },
    rpc: mockRpc,
    storage: {
      from: () => ({
        createSignedUrl: mockSignedUrl,
        download: mockDownload,
      }),
    },
    from: (table: string) => ({
      select: () => {
        const rows = table === 'lv_subject_photos' ? photos : subjects;
        const chain: any = {
          eq: () => chain,
          order: () => chain,
          limit: () => Promise.resolve({ data: rows, error: null }),
          in: () => Promise.resolve({ data: rows, error: null }),
          maybeSingle: () =>
            Promise.resolve({
              data:
                table === 'lv_memberships'
                  ? isMember
                    ? { workspace_id: WORKSPACE_ID, role }
                    : null
                  : isAgency
                    ? { id: WORKSPACE_ID }
                    : null,
              error: null,
            }),
        };
        return chain;
      },
    }),
  }));
}

function makeFormRequest(action: string, fields: Record<string, string | File> = {}) {
  const form = new FormData();
  form.set('action', action);
  for (const [k, v] of Object.entries(fields)) {
    form.set(k, v);
  }
  return new Request('http://localhost/api/face-intelligence', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer jwt-token',
      'X-Workspace-Id': WORKSPACE_ID,
    },
    body: form,
  });
}

describe('api/face-intelligence', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('blocks non-agency workspaces and unauthorized members with 403', async () => {
    setupSupabaseMock({ isAgency: false });
    const req = makeFormRequest('search_database', {
      photo: new File([new Uint8Array(64).fill(1)], 'probe.jpg', { type: 'image/jpeg' }),
    });
    const res = await handleFaceIntelligence(req, makeEnv());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Active agency membership is required.' });
  });

  it('blocks viewer/member roles from biometric subject enrollment', async () => {
    setupSupabaseMock({ role: 'member' });
    const req = makeFormRequest('enroll_face', {
      photo: new File([new Uint8Array(64).fill(1)], 'mugshot.jpg', { type: 'image/jpeg' }),
    });
    const res = await handleFaceIntelligence(req, makeEnv());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Your role cannot enroll biometric subjects.' });
  });

  it('initializes isolated agency FaceSet and indexes enrolled subject photo', async () => {
    setupSupabaseMock({ role: 'investigator' });
    const fetchMock = vi
      .fn()
      // 1. /detect
      .mockResolvedValueOnce(
        Response.json({
          faces: [
            {
              face_token: 'ftok_1001',
              attributes: { facequality: { value: 91.4 }, blur: { blurness: { value: 3.1 } }, headpose: { yaw_angle: 2.0 } },
            },
          ],
        }),
      )
      // 2. /faceset/getdetail -> INVALID_OUTER_ID triggers /faceset/create
      .mockResolvedValueOnce(Response.json({ error_message: 'INVALID_OUTER_ID' }, { status: 400 }))
      // 3. /faceset/create
      .mockResolvedValueOnce(Response.json({ faceset_token: 'fset_01', outer_id: OUTER_ID }))
      // 4. /faceset/addface
      .mockResolvedValueOnce(Response.json({ face_added: 1, face_count: 1 }));
    globalThis.fetch = fetchMock as any;

    const req = makeFormRequest('enroll_face', {
      photo: new File([new Uint8Array(64).fill(3)], 'mugshot.jpg', { type: 'image/jpeg' }),
    });
    const res = await handleFaceIntelligence(req, makeEnv());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual(
      expect.objectContaining({
        face_token: 'ftok_1001',
        faceset_outer_id: OUTER_ID,
        face_indexed: true,
        quality_score: 91.4,
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[2][0])).toBe('https://api-us.faceplusplus.com/facepp/v3/faceset/create');
    expect((fetchMock.mock.calls[2][1].body as FormData).get('outer_id')).toBe(OUTER_ID);
  });

  it('performs 1:N search, hydrates multi-angle dossiers, classifies confidence band, and logs audit history', async () => {
    setupSupabaseMock({
      role: 'investigator',
      subjects: [
        {
          id: 'sub-1',
          subject_code: 'AFIS-009',
          full_name: 'Kolawole Adeyemi',
          aliases: 'Kola',
          category: 'wanted',
          threat_level: 'high',
          offense_summary: 'Armed hijacking syndicate',
          warrant_reference: 'WR-909',
          case_reference: 'CR-404',
          last_known_location: 'Apapa Port Gate',
          status: 'active',
          primary_photo_path: `${WORKSPACE_ID}/subjects/kola.jpg`,
          face_token: 'ftok_primary',
        },
      ],
      photos: [
        {
          subject_id: 'sub-1',
          face_token: 'ftok_angle_left',
          storage_path: `${WORKSPACE_ID}/subjects/kola_left.jpg`,
        },
      ],
    });

    const fetchMock = vi
      .fn()
      // 1. /detect probe
      .mockResolvedValueOnce(
        Response.json({
          faces: [
            {
              face_token: 'probe_tok',
              attributes: { facequality: { value: 84.2 }, blur: { blurness: { value: 5.5 } } },
            },
          ],
        }),
      )
      // 2. /faceset/getdetail
      .mockResolvedValueOnce(Response.json({ faceset_token: 'fset_01', outer_id: OUTER_ID }))
      // 3. /search (matches side-angle token ftok_angle_left + lower score primary token)
      .mockResolvedValueOnce(
        Response.json({
          thresholds: { '1e-3': 62.3, '1e-4': 69.1, '1e-5': 73.9 },
          results: [
            { face_token: 'ftok_angle_left', confidence: 88.6 },
            { face_token: 'ftok_primary', confidence: 76.2 },
          ],
        }),
      );
    globalThis.fetch = fetchMock as any;

    const req = makeFormRequest('search_database', {
      photo: new File([new Uint8Array(64).fill(5)], 'gate-cam.jpg', { type: 'image/jpeg' }),
      case_reference: 'CR-404',
      notes: 'Camera 3 match check',
      probe_snapshot_path: `${WORKSPACE_ID}/probes/snap.jpg`,
    });
    const res = await handleFaceIntelligence(req, makeEnv());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.search_id).toBe('search-log-001');
    expect(body.faceset_outer_id).toBe(OUTER_ID);
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0]).toEqual(
      expect.objectContaining({
        subject_id: 'sub-1',
        full_name: 'Kolawole Adeyemi',
        confidence: 88.6,
        band: 'high',
        photo_url: 'https://signed.example/subject.jpg',
      }),
    );
    expect(mockRpc).toHaveBeenCalledWith(
      'lv_log_face_search',
      expect.objectContaining({
        target: WORKSPACE_ID,
        mode: 'faceset_1n',
        confidence: 88.6,
        case_ref: 'CR-404',
      }),
    );
  });

  it('enforces supervisor+ role for remove_face and deletes tokens from agency FaceSet', async () => {
    setupSupabaseMock({ role: 'investigator' });
    const denied = await handleFaceIntelligence(
      makeFormRequest('remove_face', { face_tokens: 'ftok_1001' }),
      makeEnv(),
    );
    expect(denied.status).toBe(403);

    setupSupabaseMock({ role: 'supervisor' });
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ face_removed: 1 }));
    globalThis.fetch = fetchMock as any;
    const allowed = await handleFaceIntelligence(
      makeFormRequest('remove_face', { face_tokens: 'ftok_1001' }),
      makeEnv({ FACEPP_REGION: 'CN' }),
    );
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ removed: true, face_removed: 1 });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api-cn.faceplusplus.com/facepp/v3/faceset/removeface');
  });

  it('recovers from /faceset/addface INTERNAL_ERROR via force_merge and falls back gracefully if both fail', async () => {
    setupSupabaseMock({ role: 'investigator' });
    const fetchMergeSuccess = vi
      .fn()
      // 1. /detect
      .mockResolvedValueOnce(Response.json({ faces: [{ face_token: 'ftok_merge', attributes: { facequality: { value: 88.2 } } }] }))
      // 2. /faceset/getdetail
      .mockResolvedValueOnce(Response.json({ faceset_token: 'fset_01', outer_id: OUTER_ID }))
      // 3. /faceset/addface returns INTERNAL_ERROR
      .mockResolvedValueOnce(Response.json({ face_added: 0, failure_detail: [{ reason: 'INTERNAL_ERROR', face_token: 'ftok_merge' }] }))
      // 4. /faceset/create with force_merge=1 succeeds
      .mockResolvedValueOnce(Response.json({ face_added: 1, face_count: 1, failure_detail: [] }));
    globalThis.fetch = fetchMergeSuccess as any;

    const res1 = await handleFaceIntelligence(
      makeFormRequest('enroll_face', { photo: new File([new Uint8Array(64).fill(4)], 'mug1.jpg', { type: 'image/jpeg' }) }),
      makeEnv(),
    );
    expect(res1.status).toBe(200);
    expect(await res1.json()).toEqual(
      expect.objectContaining({
        face_token: 'ftok_merge',
        face_indexed: true,
        index_warning: null,
      }),
    );
    expect((fetchMergeSuccess.mock.calls[3][1].body as FormData).get('force_merge')).toBe('1');

    // When both /faceset/addface and force_merge return INTERNAL_ERROR, return 200 with face_indexed: false
    const fetchBothFail = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ faces: [{ face_token: 'ftok_fb', attributes: { facequality: { value: 85.0 } } }] }))
      .mockResolvedValueOnce(Response.json({ faceset_token: 'fset_01', outer_id: OUTER_ID }))
      .mockResolvedValueOnce(Response.json({ face_added: 0, failure_detail: [{ reason: 'INTERNAL_ERROR' }] }))
      .mockResolvedValueOnce(Response.json({ face_added: 0, failure_detail: [{ reason: 'INTERNAL_ERROR' }] }));
    globalThis.fetch = fetchBothFail as any;

    const res2 = await handleFaceIntelligence(
      makeFormRequest('enroll_face', { photo: new File([new Uint8Array(64).fill(6)], 'mug2.jpg', { type: 'image/jpeg' }) }),
      makeEnv(),
    );
    expect(res2.status).toBe(200);
    expect(await res2.json()).toEqual(
      expect.objectContaining({
        face_token: 'ftok_fb',
        face_indexed: false,
        index_warning: 'INTERNAL_ERROR',
      }),
    );
  });

  it('uses direct /compare fallback (including storage image download on INVALID_FACE_TOKEN) when 1:N /search returns empty', async () => {
    setupSupabaseMock({
      role: 'investigator',
      subjects: [
        {
          id: 'sub-unindexed',
          subject_code: 'AFIS-2026-99A',
          full_name: 'Musa Ibrahim',
          aliases: '',
          category: 'wanted',
          threat_level: 'high',
          offense_summary: 'Interpol border alert',
          warrant_reference: 'WR-77',
          case_reference: 'CR-77',
          last_known_location: 'Kano',
          status: 'active',
          primary_photo_path: `${WORKSPACE_ID}/subjects/musa.jpg`,
          face_token: 'expired_tok_old',
          face_indexed: false,
        },
      ],
      photos: [],
    });

    const fetchFallback = vi
      .fn()
      // 1. /detect probe
      .mockResolvedValueOnce(Response.json({ faces: [{ face_token: 'probe_200', attributes: { facequality: { value: 90.1 } } }] }))
      // 2. /faceset/getdetail
      .mockResolvedValueOnce(Response.json({ faceset_token: 'fset_01', outer_id: OUTER_ID }))
      // 3. /search returns empty results
      .mockResolvedValueOnce(Response.json({ results: [] }))
      // 4. /compare with expired face_token2 fails with INVALID_FACE_TOKEN
      .mockResolvedValueOnce(Response.json({ error_message: 'INVALID_FACE_TOKEN' }, { status: 400 }))
      // 5. /compare retries by downloading private storage image_file2 and matches!
      .mockResolvedValueOnce(
        Response.json({
          confidence: 94.4,
          thresholds: { '1e-3': 62.3, '1e-4': 69.1, '1e-5': 73.9 },
          faces2: [{ face_token: 'refreshed_tok_musa' }],
        }),
      );
    globalThis.fetch = fetchFallback as any;

    const req = makeFormRequest('search_database', {
      photo: new File([new Uint8Array(64).fill(8)], 'probe-gate.jpg', { type: 'image/jpeg' }),
    });
    const res = await handleFaceIntelligence(req, makeEnv());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(mockDownload).toHaveBeenCalledWith(`${WORKSPACE_ID}/subjects/musa.jpg`);
    expect(body.fallback_compared).toBe(1);
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0]).toEqual(
      expect.objectContaining({
        subject_id: 'sub-unindexed',
        full_name: 'Musa Ibrahim',
        confidence: 94.4,
        band: 'high',
        face_token: 'refreshed_tok_musa',
      }),
    );
  });
});

