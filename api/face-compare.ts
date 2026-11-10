import { createClient } from '@supabase/supabase-js';

const maxPhotoBytes = 1_250_000;
const allowedTypes = new Set(['image/jpeg', 'image/png']);
const endpoint = 'https://api-us.faceplusplus.com/facepp/v3/compare';

function json(status: number, data: object) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function isPhoto(entry: FormDataEntryValue | null): entry is File {
  return entry !== null && typeof entry !== 'string' && allowedTypes.has(entry.type)
    && entry.size > 0 && entry.size <= maxPhotoBytes;
}

export async function POST(request: Request) {
  const accessToken = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if (!accessToken) return json(401, { error: 'Sign in to compare faces.' });

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return json(503, { error: 'Workspace authentication is unavailable.' });

  try {
    const client = createClient(url, key, {
      global: { headers: { Authorization: 'Bearer ' + accessToken } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: { user }, error: authError } = await client.auth.getUser(accessToken);
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

    const apiKey = process.env.FACEPP_API_KEY;
    const apiSecret = process.env.FACEPP_API_SECRET;
    if (!apiKey || !apiSecret) return json(503, { error: 'The face comparison provider is not configured.' });

    const input = await request.formData().catch(() => null);
    const reference = input?.get('reference') ?? null;
    const candidate = input?.get('candidate') ?? null;
    if (!isPhoto(reference) || !isPhoto(candidate)) {
      return json(400, { error: 'Choose two JPEG or PNG files under 1.25 MB each.' });
    }

    const photos = new FormData();
    photos.set('api_key', apiKey);
    photos.set('api_secret', apiSecret);
    photos.set('image_file1', reference, 'reference');
    photos.set('image_file2', candidate, 'candidate');

    const response = await fetch(endpoint, { method: 'POST', body: photos, signal: AbortSignal.timeout(18_000), redirect: 'error' });
    if (!response.ok) return json(502, { error: 'Face comparison failed. Check that each photo clearly shows one face and try again.' });
    const result = await response.json();
    const score = result.confidence;
    const threshold = result.thresholds?.['1e-5'];
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) {
      return json(422, { error: 'No comparison score was returned. Use clear photos showing one face each.' });
    }
    return json(200, {
      score,
      threshold: typeof threshold === 'number' && Number.isFinite(threshold) && threshold >= 0 && threshold <= 100 ? threshold : null,
    });
  } catch {
    return json(502, { error: 'Face comparison is temporarily unavailable.' });
  }
}
