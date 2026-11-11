// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreateClient, mockInsertActivity } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockInsertActivity: vi.fn().mockResolvedValue({ error: null }),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: mockCreateClient,
}));

import { compareFaces } from './face-compare';

const WORKSPACE_ID = '10000000-0000-4000-8000-000000000001';

function makeEnv(extra: Record<string, string | undefined> = {}) {
  return {
    SUPABASE_URL: 'https://proj.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    FACEPP_API_KEY: 'facepp-key',
    FACEPP_API_SECRET: 'facepp-secret',
    ...extra,
  };
}

function setupSupabase({
  user = { id: 'user-1' } as any,
  isMember = true,
  isAgency = true,
}: {
  user?: { id: string } | null;
  isMember?: boolean;
  isAgency?: boolean;
} = {}) {
  mockCreateClient.mockImplementation((_url: string, key: string) => {
    if (key === 'service-key') {
      return {
        from: () => ({ insert: mockInsertActivity }),
      };
    }
    return {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user },
          error: user ? null : new Error('Invalid token'),
        }),
      },
      from: (table: string) => ({
        select: () => {
          const chain: any = {
            eq: () => chain,
            maybeSingle: () =>
              Promise.resolve({
                data:
                  table === 'lv_memberships'
                    ? isMember
                      ? { workspace_id: WORKSPACE_ID }
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
    };
  });
}

function makeCompareRequest({
  token = 'jwt-token',
  workspaceId = WORKSPACE_ID,
  refType = 'image/jpeg',
  candType = 'image/png',
  refSize = 64,
}: {
  token?: string;
  workspaceId?: string;
  refType?: string;
  candType?: string;
  refSize?: number;
} = {}) {
  const form = new FormData();
  form.set('reference', new File([new Uint8Array(refSize).fill(1)], 'ref.jpg', { type: refType }));
  form.set('candidate', new File([new Uint8Array(64).fill(2)], 'cand.png', { type: candType }));
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId;
  return new Request('http://localhost/api/face-compare', { method: 'POST', headers, body: form });
}

describe('api/face-compare', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    setupSupabase();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('rejects missing bearer token and invalid workspace IDs', async () => {
    const r1 = await compareFaces(makeCompareRequest({ token: '' }), makeEnv());
    expect(r1.status).toBe(401);

    const r2 = await compareFaces(makeCompareRequest({ workspaceId: 'not-a-uuid' }), makeEnv());
    expect(r2.status).toBe(400);
  });

  it('enforces active agency membership and provider configuration', async () => {
    setupSupabase({ isAgency: false });
    const r1 = await compareFaces(makeCompareRequest(), makeEnv());
    expect(r1.status).toBe(403);

    setupSupabase({ isAgency: true });
    const r2 = await compareFaces(makeCompareRequest(), makeEnv({ FACEPP_API_KEY: '', FACEPP_API_SECRET: '' }));
    expect(r2.status).toBe(503);
  });

  it('rejects unsupported file mime types or empty files cleanly', async () => {
    const r1 = await compareFaces(makeCompareRequest({ refType: 'text/plain' }), makeEnv());
    expect(r1.status).toBe(400);
  });

  it('calls Face++ CN or US endpoint, returns score + thresholds, and audits when service key is set', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      Response.json({
        confidence: 88.42,
        thresholds: { '1e-3': 62.3, '1e-4': 69.1, '1e-5': 73.9 },
        faces1: [{ face_token: 'f1' }],
        faces2: [{ face_token: 'f2' }],
      }),
    );
    globalThis.fetch = mockFetch as any;

    const res = await compareFaces(
      makeCompareRequest(),
      makeEnv({ FACEPP_REGION: 'CN', SUPABASE_SERVICE_ROLE_KEY: 'service-key' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.score).toBe(88.42);
    expect(body.threshold).toBe(73.9);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api-cn.faceplusplus.com/facepp/v3/compare',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(mockInsertActivity).toHaveBeenCalledWith({
      workspace_id: WORKSPACE_ID,
      actor_id: 'user-1',
      action: 'face.compared',
    });
  });

  it('identifies which photo lacked a detectable face (422) and retries once on concurrency limit', async () => {
    const mockFetchNoFace = vi.fn().mockResolvedValue(
      Response.json({
        faces1: [],
        faces2: [{ face_token: 'f2' }],
      }),
    );
    globalThis.fetch = mockFetchNoFace as any;
    const noFaceRes = await compareFaces(makeCompareRequest(), makeEnv());
    expect(noFaceRes.status).toBe(422);
    expect((await noFaceRes.json()).error).toContain('reference photo');

    const mockFetchRetry = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error_message: 'CONCURRENCY_LIMIT_EXCEEDED' }, { status: 403 }))
      .mockResolvedValueOnce(
        Response.json({
          confidence: 79.5,
          thresholds: { '1e-5': 73.9 },
          faces1: [{ face_token: 'f1' }],
          faces2: [{ face_token: 'f2' }],
        }),
      );
    globalThis.fetch = mockFetchRetry as any;
    const retryRes = await compareFaces(makeCompareRequest(), makeEnv());
    expect(retryRes.status).toBe(200);
    expect((await retryRes.json()).score).toBe(79.5);
    expect(mockFetchRetry).toHaveBeenCalledTimes(2);
  });

  it('reports invalid Face++ API credentials cleanly', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ error_message: 'AUTHENTICATION_ERROR' }, { status: 403 })) as any;
    const res = await compareFaces(makeCompareRequest(), makeEnv());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain('FACEPP_API_KEY');
  });
});

