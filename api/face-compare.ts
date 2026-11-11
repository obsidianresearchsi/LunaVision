import { createClient } from '@supabase/supabase-js';

const maxPhotoBytes = 1_250_000;
const allowedTypes = new Set(['image/jpeg', 'image/png']);
const endpoints = {
  US: 'https://api-us.faceplusplus.com/facepp/v3/compare',
  CN: 'https://api-cn.faceplusplus.com/facepp/v3/compare',
} as const;

function json(status: number, data: object) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}

function isPhoto(entry: FormDataEntryValue | null): entry is File {
  return (
    entry !== null &&
    typeof entry !== 'string' &&
    allowedTypes.has(entry.type) &&
    entry.size > 0 &&
    entry.size <= maxPhotoBytes
  );
}

function fileNameFor(prefix: string, file: File): string {
  return file.type === 'image/png' ? `${prefix}.png` : `${prefix}.jpg`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callFacePlusPlus(
  endpoint: string,
  photos: FormData,
  retried = false,
): Promise<{ status: number; payload: any }> {
  const response = await fetch(endpoint, {
    method: 'POST',
    body: photos,
    signal: AbortSignal.timeout(18_000),
    redirect: 'error',
  });
  const payload = await response.json().catch(() => null);
  if (payload?.error_message === 'CONCURRENCY_LIMIT_EXCEEDED' && !retried) {
    await sleep(1100);
    return callFacePlusPlus(endpoint, photos, true);
  }
  return { status: response.status, payload };
}

export async function POST(request: Request) {
  return compareFaces(request, process.env);
}

export async function compareFaces(request: Request, env: Record<string, string | undefined> = process.env) {
  const accessToken = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if (!accessToken) return json(401, { error: 'Sign in to compare faces.' });

  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return json(503, { error: 'Workspace authentication is unavailable.' });

  try {
    const authOpts = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
    const client = createClient(url, key, {
      global: { headers: { Authorization: 'Bearer ' + accessToken } },
      auth: authOpts,
    });
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser(accessToken);
    if (authError || !user) return json(401, { error: 'Sign in again to compare faces.' });

    const workspace = request.headers.get('x-workspace-id');
    if (!workspace || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(workspace)) {
      return json(400, { error: 'Select a valid agency workspace.' });
    }

    const [membership, organization] = await Promise.all([
      client.from('lv_memberships').select('workspace_id').eq('workspace_id', workspace).eq('user_id', user.id).maybeSingle(),
      client.from('lv_workspaces').select('id').eq('id', workspace).eq('kind', 'agency').eq('active', true).maybeSingle(),
    ]);
    if (membership.error || organization.error) return json(503, { error: 'Agency access could not be verified.' });
    if (!membership.data || !organization.data) return json(403, { error: 'Active agency membership is required.' });

    const apiKey = env.FACEPP_API_KEY?.trim();
    const apiSecret = env.FACEPP_API_SECRET?.trim();
    if (!apiKey || !apiSecret) {
      return json(503, { error: 'The face comparison provider is not configured.' });
    }

    const region = env.FACEPP_REGION?.trim().toUpperCase() === 'CN' ? 'CN' : 'US';
    const endpoint = endpoints[region];

    const input = await request.formData().catch(() => null);
    const reference = input?.get('reference') ?? null;
    const candidate = input?.get('candidate') ?? null;
    if (!isPhoto(reference) || !isPhoto(candidate)) {
      return json(400, { error: 'Provide valid reference and candidate JPEG or PNG files under 1.25 MB each.' });
    }

    const photos = new FormData();
    photos.set('api_key', apiKey);
    photos.set('api_secret', apiSecret);
    photos.set('image_file1', reference, fileNameFor('reference', reference));
    photos.set('image_file2', candidate, fileNameFor('candidate', candidate));

    const { status: providerStatus, payload: result } = await callFacePlusPlus(endpoint, photos);
    const errMsg = typeof result?.error_message === 'string' ? result.error_message : '';

    if (errMsg) {
      if (errMsg === 'AUTHENTICATION_ERROR') {
        return json(503, {
          error: 'Face++ credentials were rejected by the provider. Check FACEPP_API_KEY, FACEPP_API_SECRET, and FACEPP_REGION.',
        });
      }
      if (errMsg === 'CONCURRENCY_LIMIT_EXCEEDED') {
        return json(429, { error: 'Face comparison provider is busy. Wait a moment and retry.' });
      }
      if (
        errMsg.includes('IMAGE') ||
        errMsg === 'INVALID_IMAGE_SIZE' ||
        errMsg === 'IMAGE_FILE_TOO_LARGE'
      ) {
        return json(400, { error: 'One or both photos could not be decoded by Face++. Upload clear JPEG or PNG photos.' });
      }
      return json(502, {
        error: 'Face comparison failed. Check that each photo clearly shows one face and try again.',
      });
    }

    if (providerStatus < 200 || providerStatus >= 300 || !result) {
      return json(502, {
        error: 'Face comparison failed. Check that each photo clearly shows one face and try again.',
      });
    }

    if (Array.isArray(result.faces1) && result.faces1.length === 0) {
      return json(422, { error: 'No face was detected in the reference photo. Choose a clear front-facing photo.' });
    }
    if (Array.isArray(result.faces2) && result.faces2.length === 0) {
      return json(422, { error: 'No face was detected in the comparison photo. Choose a clear front-facing photo.' });
    }

    const score = result.confidence;
    const threshold = result.thresholds?.['1e-5'];
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) {
      return json(422, { error: 'No comparison score was returned. Use clear photos showing one face each.' });
    }

    // Best-effort audit record if service role key is configured on the server
    if (env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      try {
        const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY.trim(), { auth: authOpts });
        await admin.from('lv_workspace_activity').insert({
          workspace_id: workspace,
          actor_id: user.id,
          action: 'face.compared',
        });
      } catch {
        // Never fail comparison if audit insert fails
      }
    }

    const validThreshold = (val: unknown) =>
      typeof val === 'number' && Number.isFinite(val) && val >= 0 && val <= 100 ? val : null;

    return json(200, {
      score,
      threshold: validThreshold(threshold),
      thresholds: {
        '1e-3': validThreshold(result.thresholds?.['1e-3']),
        '1e-4': validThreshold(result.thresholds?.['1e-4']),
        '1e-5': validThreshold(result.thresholds?.['1e-5']),
      },
    });
  } catch {
    return json(502, { error: 'Face comparison is temporarily unavailable.' });
  }
}
