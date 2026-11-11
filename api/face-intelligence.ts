import { createClient } from '@supabase/supabase-js';

const MAX_PHOTO_BYTES = 1_250_000;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png']);
const UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function faceppBaseUrl(region: string | undefined): string {
  return region?.trim().toUpperCase() === 'CN'
    ? 'https://api-cn.faceplusplus.com/facepp/v3'
    : 'https://api-us.faceplusplus.com/facepp/v3';
}

function json(status: number, data: object) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}

function isValidPhoto(entry: FormDataEntryValue | null): entry is File {
  return (
    entry !== null &&
    typeof entry !== 'string' &&
    ALLOWED_TYPES.has(entry.type) &&
    entry.size > 0 &&
    entry.size <= MAX_PHOTO_BYTES
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function agencyOuterId(workspaceId: string): string {
  return 'lv_' + workspaceId.replace(/-/g, '').toLowerCase();
}

async function callFacePP(
  baseUrl: string,
  path: string,
  params: FormData,
  attempt = 0,
): Promise<{ ok: boolean; status: number; data: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    body: params,
    signal: AbortSignal.timeout(20_000),
    redirect: 'error',
  });
  const data = await response.json().catch(() => null);
  const errMsg = typeof data?.error_message === 'string' ? data.error_message : '';
  if (errMsg === 'CONCURRENCY_LIMIT_EXCEEDED' && attempt < 3) {
    await sleep(1100 * (attempt + 1));
    return callFacePP(baseUrl, path, params, attempt + 1);
  }
  return { ok: response.ok && !errMsg, status: response.status, data };
}

async function ensureAgencyFaceset(
  baseUrl: string,
  apiKey: string,
  apiSecret: string,
  outerId: string,
): Promise<void> {
  const detailForm = new FormData();
  detailForm.set('api_key', apiKey);
  detailForm.set('api_secret', apiSecret);
  detailForm.set('outer_id', outerId);
  const detailRes = await callFacePP(baseUrl, '/faceset/getdetail', detailForm);
  if (detailRes.ok) return;

  const msg = String(detailRes.data?.error_message || '');
  if (msg.includes('INVALID_OUTER_ID') || msg.includes('FACESET_NOT_EXIST')) {
    const createForm = new FormData();
    createForm.set('api_key', apiKey);
    createForm.set('api_secret', apiSecret);
    createForm.set('outer_id', outerId);
    createForm.set('display_name', outerId.slice(0, 40));
    createForm.set('force_merge', '1');
    const createRes = await callFacePP(baseUrl, '/faceset/create', createForm);
    if (!createRes.ok) {
      throw new Error(String(createRes.data?.error_message || 'Could not initialize agency FaceSet.'));
    }
    return;
  }
  throw new Error(msg || 'Could not inspect agency FaceSet.');
}

function classifyBand(confidence: number, thresholds: Record<string, number>): 'high' | 'medium' | 'investigative' | 'below_threshold' {
  const t5 = thresholds['1e-5'] ?? 73.9;
  const t4 = thresholds['1e-4'] ?? 69.1;
  const t3 = thresholds['1e-3'] ?? 62.3;
  if (confidence >= t5) return 'high';
  if (confidence >= t4) return 'medium';
  if (confidence >= t3) return 'investigative';
  return 'below_threshold';
}

type SubjectMatch = {
  subject_id: string;
  subject_code: string | null;
  full_name: string;
  aliases: string;
  category: string;
  threat_level: string;
  offense_summary: string;
  warrant_reference: string;
  case_reference: string;
  last_known_location: string;
  status: string;
  face_token: string;
  confidence: number;
  band: 'high' | 'medium' | 'investigative' | 'below_threshold';
  photo_url: string | null;
};

function hasIndexingFailure(res: { ok: boolean; data: any }): boolean {
  if (!res.ok) return true;
  if (Number(res.data?.face_added ?? 0) < 1) return true;
  return Array.isArray(res.data?.failure_detail) && res.data.failure_detail.length > 0;
}

async function indexFaceInAgencyFaceset(
  baseUrl: string,
  apiKey: string,
  apiSecret: string,
  outerId: string,
  faceToken: string,
): Promise<{ faceIndexed: boolean; indexWarning: string | null }> {
  const addForm = new FormData();
  addForm.set('api_key', apiKey);
  addForm.set('api_secret', apiSecret);
  addForm.set('outer_id', outerId);
  addForm.set('face_tokens', faceToken);
  const addRes = await callFacePP(baseUrl, '/faceset/addface', addForm);
  if (!hasIndexingFailure(addRes)) {
    return { faceIndexed: true, indexWarning: null };
  }

  // Face++ /faceset/addface intermittently returns INTERNAL_ERROR on US endpoints;
  // /faceset/create with force_merge=1 appends tokens cleanly on existing FaceSets.
  const mergeForm = new FormData();
  mergeForm.set('api_key', apiKey);
  mergeForm.set('api_secret', apiSecret);
  mergeForm.set('outer_id', outerId);
  mergeForm.set('display_name', outerId.slice(0, 40));
  mergeForm.set('face_tokens', faceToken);
  mergeForm.set('force_merge', '1');
  const mergeRes = await callFacePP(baseUrl, '/faceset/create', mergeForm);
  if (!hasIndexingFailure(mergeRes)) {
    return { faceIndexed: true, indexWarning: null };
  }

  const warning =
    mergeRes.data?.failure_detail?.[0]?.reason ||
    addRes.data?.failure_detail?.[0]?.reason ||
    mergeRes.data?.error_message ||
    addRes.data?.error_message ||
    'Provider FaceSet indexing unavailable; saved for direct compare fallback.';
  return { faceIndexed: false, indexWarning: String(warning) };
}

async function signSubjectPhotoUrl(
  client: any,
  cache: Map<string, string | null>,
  storagePath: string | null | undefined,
): Promise<string | null> {
  if (!storagePath) return null;
  if (cache.has(storagePath)) return cache.get(storagePath) ?? null;
  const { data: signed } = await client.storage.from('lv-subject-photos').createSignedUrl(storagePath, 600);
  const url = signed?.signedUrl ? String(signed.signedUrl) : null;
  cache.set(storagePath, url);
  return url;
}

async function recordSubjectMatch(
  matchesBySubject: Map<string, SubjectMatch>,
  client: any,
  signedUrlCache: Map<string, string | null>,
  subject: any,
  storagePath: string | null | undefined,
  faceToken: string,
  confidence: number,
  thresholds: Record<string, number>,
): Promise<void> {
  const existing = matchesBySubject.get(subject.id);
  if (existing && confidence <= existing.confidence) return;
  const photoUrl = await signSubjectPhotoUrl(client, signedUrlCache, storagePath || subject.primary_photo_path);
  matchesBySubject.set(subject.id, {
    subject_id: subject.id,
    subject_code: subject.subject_code,
    full_name: subject.full_name,
    aliases: subject.aliases,
    category: subject.category,
    threat_level: subject.threat_level,
    offense_summary: subject.offense_summary,
    warrant_reference: subject.warrant_reference,
    case_reference: subject.case_reference,
    last_known_location: subject.last_known_location,
    status: subject.status,
    face_token: faceToken,
    confidence,
    band: classifyBand(confidence, thresholds),
    photo_url: photoUrl,
  });
}

async function compareProbeWithCandidate(
  baseUrl: string,
  apiKey: string,
  apiSecret: string,
  client: any,
  probeToken: string,
  candidateFaceToken: string | null | undefined,
  storagePath: string | null | undefined,
): Promise<{ confidence: number; thresholds?: Record<string, number>; faceToken: string } | null> {
  if (candidateFaceToken) {
    const tokenForm = new FormData();
    tokenForm.set('api_key', apiKey);
    tokenForm.set('api_secret', apiSecret);
    tokenForm.set('face_token1', probeToken);
    tokenForm.set('face_token2', candidateFaceToken);
    const tokenRes = await callFacePP(baseUrl, '/compare', tokenForm);
    if (tokenRes.ok && typeof tokenRes.data?.confidence === 'number') {
      return {
        confidence: tokenRes.data.confidence,
        thresholds: tokenRes.data.thresholds,
        faceToken: candidateFaceToken,
      };
    }
  }

  // Fallback to private storage mugshot when an unindexed face_token expires (>72h) or is absent.
  if (!storagePath || typeof client.storage.from('lv-subject-photos')?.download !== 'function') {
    return null;
  }
  const { data: blob, error: dlErr } = await client.storage.from('lv-subject-photos').download(storagePath);
  if (dlErr || !blob) return null;

  const bytes = typeof blob.arrayBuffer === 'function' ? await blob.arrayBuffer() : blob;
  const imageBlob = new Blob([bytes], { type: blob.type || 'image/jpeg' });
  const fileForm = new FormData();
  fileForm.set('api_key', apiKey);
  fileForm.set('api_secret', apiSecret);
  fileForm.set('face_token1', probeToken);
  fileForm.set('image_file2', imageBlob, 'enrolled-subject.jpg');
  const fileRes = await callFacePP(baseUrl, '/compare', fileForm);
  if (!fileRes.ok || typeof fileRes.data?.confidence !== 'number') return null;

  return {
    confidence: fileRes.data.confidence,
    thresholds: fileRes.data.thresholds,
    faceToken: String(fileRes.data?.faces2?.[0]?.face_token || candidateFaceToken || ''),
  };
}

async function fallbackCompareGallery(opts: {
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  client: any;
  workspaceId: string;
  probeToken: string;
  matchesBySubject: Map<string, SubjectMatch>;
  thresholds: Record<string, number>;
  signedUrlCache: Map<string, string | null>;
  startedAt: number;
}): Promise<{ thresholds: Record<string, number>; comparedCount: number }> {
  const { baseUrl, apiKey, apiSecret, client, workspaceId, probeToken, matchesBySubject, signedUrlCache, startedAt } = opts;
  let thresholds = opts.thresholds;

  const { data: subjectRows } = await client
    .from('lv_agency_subjects')
    .select(
      'id,subject_code,full_name,aliases,category,threat_level,offense_summary,warrant_reference,case_reference,last_known_location,status,primary_photo_path,face_token,face_indexed',
    )
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .order('face_indexed', { ascending: true })
    .order('updated_at', { ascending: false })
    .limit(24);

  const unmatchedSubjects = (Array.isArray(subjectRows) ? subjectRows : []).filter((s: any) => !matchesBySubject.has(s.id));
  if (unmatchedSubjects.length === 0) return { thresholds, comparedCount: 0 };

  const { data: extraPhotoRows } = await client
    .from('lv_subject_photos')
    .select('subject_id,face_token,storage_path,is_primary')
    .eq('workspace_id', workspaceId)
    .in(
      'subject_id',
      unmatchedSubjects.map((s: any) => s.id),
    );

  const photosBySubject = new Map<string, { face_token: string | null; storage_path: string | null }[]>();
  for (const row of Array.isArray(extraPhotoRows) ? extraPhotoRows : []) {
    const list = photosBySubject.get(row.subject_id) || [];
    list.push({ face_token: row.face_token || null, storage_path: row.storage_path || null });
    photosBySubject.set(row.subject_id, list);
  }

  // Prioritize checking each subject's primary photo before secondary angles within serverless budget.
  const primaryPass: { subject: any; faceToken: string | null; storagePath: string | null }[] = [];
  const secondaryPass: { subject: any; faceToken: string | null; storagePath: string | null }[] = [];
  for (const subject of unmatchedSubjects) {
    const extras = photosBySubject.get(subject.id) || [];
    const primaryToken = subject.face_token || extras[0]?.face_token || null;
    const primaryPath = subject.primary_photo_path || extras[0]?.storage_path || null;
    if (primaryToken || primaryPath) {
      primaryPass.push({ subject, faceToken: primaryToken, storagePath: primaryPath });
    }
    const alt = extras.find((p) => (p.face_token && p.face_token !== primaryToken) || (p.storage_path && p.storage_path !== primaryPath));
    if (alt) {
      secondaryPass.push({ subject, faceToken: alt.face_token, storagePath: alt.storage_path });
    }
  }

  let comparedCount = 0;
  for (const item of [...primaryPass, ...secondaryPass]) {
    if (comparedCount >= 24 || Date.now() - startedAt > 7500) break;
    if (matchesBySubject.has(item.subject.id) && (matchesBySubject.get(item.subject.id)?.confidence ?? 0) >= (thresholds['1e-5'] ?? 73.9)) {
      continue;
    }
    comparedCount++;
    const cmp = await compareProbeWithCandidate(baseUrl, apiKey, apiSecret, client, probeToken, item.faceToken, item.storagePath);
    if (!cmp) continue;
    if (cmp.thresholds) thresholds = cmp.thresholds;

    const minCandidateScore = Math.max(50, (thresholds['1e-3'] ?? 62.3) - 12);
    if (cmp.confidence < minCandidateScore) continue;

    await recordSubjectMatch(
      matchesBySubject,
      client,
      signedUrlCache,
      item.subject,
      item.storagePath,
      cmp.faceToken,
      cmp.confidence,
      thresholds,
    );
  }

  return { thresholds, comparedCount };
}

export async function POST(request: Request) {
  return handleFaceIntelligence(request, process.env);
}

export async function handleFaceIntelligence(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): Promise<Response> {
  const accessToken = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if (!accessToken) return json(401, { error: 'Sign in to access face intelligence.' });

  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return json(503, { error: 'Workspace authentication is unavailable.' });

  const workspaceId = request.headers.get('x-workspace-id') || '';
  if (!UUID_RE.test(workspaceId)) return json(400, { error: 'Select a valid agency workspace.' });

  const apiKey = env.FACEPP_API_KEY?.trim();
  const apiSecret = env.FACEPP_API_SECRET?.trim();
  if (!apiKey || !apiSecret) return json(503, { error: 'The Face++ provider is not configured.' });

  const baseUrl = faceppBaseUrl(env.FACEPP_REGION);

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
    if (authError || !user) return json(401, { error: 'Sign in again to continue.' });

    const [membership, organization] = await Promise.all([
      client.from('lv_memberships').select('workspace_id,role').eq('workspace_id', workspaceId).eq('user_id', user.id).maybeSingle(),
      client.from('lv_workspaces').select('id').eq('id', workspaceId).eq('kind', 'agency').eq('active', true).maybeSingle(),
    ]);
    if (membership.error || organization.error) return json(503, { error: 'Agency access could not be verified.' });
    if (!membership.data || !organization.data) return json(403, { error: 'Active agency membership is required.' });

    const form = await request.formData().catch(() => null);
    if (!form) return json(400, { error: 'Invalid multipart request.' });

    const action = String(form.get('action') || '').trim();
    const outerId = agencyOuterId(workspaceId);

    // -----------------------------------------------------------------------
    // Action 1: Detect + Index a Subject Photo into the Agency's Isolated FaceSet
    // -----------------------------------------------------------------------
    if (action === 'enroll_face') {
      const role = String((membership.data as any).role || 'member');
      if (!['owner', 'admin', 'supervisor', 'investigator'].includes(role)) {
        return json(403, { error: 'Your role cannot enroll biometric subjects.' });
      }
      const { data: featMap } = await client.rpc('lv_workspace_feature_map', { target: workspaceId });
      if (featMap && (featMap as any).biometric_enrollment === false) {
        return json(403, { error: 'Biometric subject enrollment is disabled for this organization.' });
      }

      const photo = form.get('photo');
      if (!isValidPhoto(photo)) {
        return json(400, { error: 'Upload a valid JPEG or PNG face photo under 1.25 MB.' });
      }

      const detectForm = new FormData();
      detectForm.set('api_key', apiKey);
      detectForm.set('api_secret', apiSecret);
      detectForm.set('image_file', photo, photo.type === 'image/png' ? 'subject.png' : 'subject.jpg');
      detectForm.set('return_attributes', 'blur,facequality,headpose');

      const detectRes = await callFacePP(baseUrl, '/detect', detectForm);
      if (!detectRes.ok) {
        const msg = String(detectRes.data?.error_message || '');
        if (msg === 'AUTHENTICATION_ERROR') {
          return json(503, { error: 'Face++ rejected credentials. Check FACEPP_API_KEY, FACEPP_API_SECRET, and FACEPP_REGION.' });
        }
        if (msg === 'CONCURRENCY_LIMIT_EXCEEDED') {
          return json(429, { error: 'Face++ rate limit reached. Retry shortly.' });
        }
        return json(400, { error: `Face detection failed: ${msg || 'Unreadable image'}` });
      }

      const faces = Array.isArray(detectRes.data?.faces) ? detectRes.data.faces : [];
      if (faces.length === 0) {
        return json(422, { error: 'No face detected in photo. Ensure the subject faces the camera cleanly.' });
      }

      const primary = faces[0];
      const faceToken = String(primary.face_token || '');
      if (!faceToken) return json(422, { error: 'Face++ did not return a valid face token.' });

      await ensureAgencyFaceset(baseUrl, apiKey, apiSecret, outerId);
      const { faceIndexed, indexWarning } = await indexFaceInAgencyFaceset(baseUrl, apiKey, apiSecret, outerId, faceToken);

      const quality = Number(primary.attributes?.facequality?.value ?? 0);
      return json(200, {
        face_token: faceToken,
        faceset_outer_id: outerId,
        face_indexed: faceIndexed,
        index_warning: indexWarning,
        face_count: faces.length,
        quality_score: Number.isFinite(quality) ? Number(quality.toFixed(1)) : null,
        telemetry: {
          blur: primary.attributes?.blur?.blurness?.value ?? null,
          headpose: primary.attributes?.headpose ?? null,
        },
      });
    }

    // -----------------------------------------------------------------------
    // Action 2: 1:N Search Across the Agency's Isolated FaceSet + Audit Log
    // -----------------------------------------------------------------------
    if (action === 'search_database') {
      const { data: featMap } = await client.rpc('lv_workspace_feature_map', { target: workspaceId });
      if (featMap && (featMap as any).face_search === false) {
        return json(403, { error: 'Face search is disabled for this organization.' });
      }

      const photo = form.get('photo');
      if (!isValidPhoto(photo)) {
        return json(400, { error: 'Upload a valid probe JPEG or PNG image under 1.25 MB.' });
      }

      const caseRef = String(form.get('case_reference') || '').trim().slice(0, 120);
      const notes = String(form.get('notes') || '').trim().slice(0, 1000);
      const probePath = form.get('probe_snapshot_path') ? String(form.get('probe_snapshot_path')).trim() : null;

      // 1. Detect probe face
      const detectForm = new FormData();
      detectForm.set('api_key', apiKey);
      detectForm.set('api_secret', apiSecret);
      detectForm.set('image_file', photo, photo.type === 'image/png' ? 'probe.png' : 'probe.jpg');
      detectForm.set('return_attributes', 'blur,facequality,headpose');

      const detectRes = await callFacePP(baseUrl, '/detect', detectForm);
      if (!detectRes.ok) {
        const msg = String(detectRes.data?.error_message || '');
        if (msg === 'AUTHENTICATION_ERROR') {
          return json(503, { error: 'Face++ rejected credentials. Check FACEPP_API_KEY, FACEPP_API_SECRET, and FACEPP_REGION.' });
        }
        return json(400, { error: `Probe face detection failed: ${msg || 'Provider error'}` });
      }

      const probeFaces = Array.isArray(detectRes.data?.faces) ? detectRes.data.faces : [];
      if (probeFaces.length === 0) {
        return json(422, { error: 'No face detected in the probe image. Use a clearer frontal or near-frontal shot.' });
      }

      const probeFace = probeFaces[0];
      const probeToken = String(probeFace.face_token || '');
      const probeTelemetry = {
        quality: probeFace.attributes?.facequality?.value ?? null,
        blur: probeFace.attributes?.blur?.blurness?.value ?? null,
        headpose: probeFace.attributes?.headpose ?? null,
        faces_in_probe: probeFaces.length,
      };

      const searchStartedAt = Date.now();

      // 2. Ensure FaceSet exists & run 1:N /search
      await ensureAgencyFaceset(baseUrl, apiKey, apiSecret, outerId);
      const searchForm = new FormData();
      searchForm.set('api_key', apiKey);
      searchForm.set('api_secret', apiSecret);
      searchForm.set('face_token', probeToken);
      searchForm.set('outer_id', outerId);
      searchForm.set('return_result_count', '5');

      const searchRes = await callFacePP(baseUrl, '/search', searchForm);
      let candidates: { face_token: string; confidence: number }[] = [];
      let thresholds: Record<string, number> = { '1e-3': 62.3, '1e-4': 69.1, '1e-5': 73.9 };

      if (searchRes.ok) {
        candidates = Array.isArray(searchRes.data?.results) ? searchRes.data.results : [];
        if (searchRes.data?.thresholds) thresholds = searchRes.data.thresholds;
      } else {
        const msg = String(searchRes.data?.error_message || '');
        // Empty/unindexed FaceSets are expected when relying on direct compare fallback
        if (!msg.includes('EMPTY') && !msg.includes('INVALID_OUTER_ID') && !msg.includes('INTERNAL_ERROR')) {
          return json(502, { error: `Face++ 1:N search failed: ${msg || 'Provider error'}` });
        }
      }

      // 3. Hydrate matched tokens against lv_agency_subjects & lv_subject_photos (respecting caller's RLS & clearance)
      const tokens = Array.from(new Set(candidates.map((c) => c.face_token).filter(Boolean)));
      const matchesBySubject = new Map<string, SubjectMatch>();
      const signedUrlCache = new Map<string, string | null>();

      if (tokens.length > 0) {
        const [subRes, phRes] = await Promise.all([
          client
            .from('lv_agency_subjects')
            .select(
              'id,subject_code,full_name,aliases,category,threat_level,offense_summary,warrant_reference,case_reference,last_known_location,status,primary_photo_path,face_token',
            )
            .eq('workspace_id', workspaceId)
            .eq('status', 'active')
            .in('face_token', tokens),
          client
            .from('lv_subject_photos')
            .select('subject_id,face_token,storage_path')
            .eq('workspace_id', workspaceId)
            .in('face_token', tokens),
        ]);

        const tokenToSubject = new Map<string, any>();
        for (const s of (subRes.data ?? []) as any[]) {
          if (s.face_token) tokenToSubject.set(s.face_token, { subject: s, path: s.primary_photo_path });
        }

        // Fetch any extra subjects referenced via multi-angle lv_subject_photos
        const photoRows = (phRes.data ?? []) as { subject_id: string; face_token: string; storage_path: string }[];
        const missingSubjectIds = photoRows
          .map((p) => p.subject_id)
          .filter((sid) => !Array.from(tokenToSubject.values()).some((v) => v.subject.id === sid));
        const extraSubjects = new Map<string, any>();
        if (missingSubjectIds.length > 0) {
          const { data: extraData } = await client
            .from('lv_agency_subjects')
            .select(
              'id,subject_code,full_name,aliases,category,threat_level,offense_summary,warrant_reference,case_reference,last_known_location,status,primary_photo_path,face_token',
            )
            .eq('workspace_id', workspaceId)
            .eq('status', 'active')
            .in('id', Array.from(new Set(missingSubjectIds)));
          for (const s of (extraData ?? []) as any[]) {
            extraSubjects.set(s.id, s);
          }
        }
        for (const p of photoRows) {
          if (!tokenToSubject.has(p.face_token)) {
            const sub =
              Array.from(tokenToSubject.values()).find((v) => v.subject.id === p.subject_id)?.subject ||
              extraSubjects.get(p.subject_id);
            if (sub) {
              tokenToSubject.set(p.face_token, { subject: sub, path: p.storage_path || sub.primary_photo_path });
            }
          }
        }

        for (const cand of candidates) {
          const entry = tokenToSubject.get(cand.face_token);
          if (!entry) continue;
          await recordSubjectMatch(
            matchesBySubject,
            client,
            signedUrlCache,
            entry.subject,
            entry.path,
            cand.face_token,
            cand.confidence,
            thresholds,
          );
        }
      }

      // Phase 2: Direct /compare fallback across active workspace subjects not yet matched in Phase 1
      let fallbackCompared = 0;
      if (matchesBySubject.size < 5) {
        const fb = await fallbackCompareGallery({
          baseUrl,
          apiKey,
          apiSecret,
          client,
          workspaceId,
          probeToken,
          matchesBySubject,
          thresholds,
          signedUrlCache,
          startedAt: searchStartedAt,
        });
        thresholds = fb.thresholds;
        fallbackCompared = fb.comparedCount;
      }

      const matches = Array.from(matchesBySubject.values())
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 10);
      const topConfidence = matches.length > 0 ? matches[0].confidence : candidates[0]?.confidence ?? null;

      // 4. Write immutable search log via lv_log_face_search RPC
      const compactLog = matches.map((m) => ({
        subject_id: m.subject_id,
        subject_code: m.subject_code,
        full_name: m.full_name,
        confidence: m.confidence,
        band: m.band,
      }));
      const { data: logId } = await client.rpc('lv_log_face_search', {
        target: workspaceId,
        mode: 'faceset_1n',
        probe_path: probePath,
        confidence: topConfidence,
        matches: compactLog,
        telemetry: probeTelemetry,
        case_ref: caseRef,
        search_notes: notes,
      });

      return json(200, {
        search_id: logId ?? null,
        faceset_outer_id: outerId,
        thresholds,
        telemetry: probeTelemetry,
        matches,
        fallback_compared: fallbackCompared,
        unlinked_candidates: Math.max(0, candidates.length - matches.length),
      });
    }

    // -----------------------------------------------------------------------
    // Action 3: Remove a face_token cleanly from the Agency's FaceSet
    // -----------------------------------------------------------------------
    if (action === 'remove_face') {
      const role = String((membership.data as any).role || 'member');
      if (!['owner', 'admin', 'supervisor'].includes(role)) {
        return json(403, { error: 'Your role cannot remove indexed biometric faces.' });
      }
      const tokens = String(form.get('face_tokens') || '').trim();
      if (!tokens) return json(400, { error: 'No face tokens specified.' });

      const removeForm = new FormData();
      removeForm.set('api_key', apiKey);
      removeForm.set('api_secret', apiSecret);
      removeForm.set('outer_id', outerId);
      removeForm.set('face_tokens', tokens);
      const res = await callFacePP(baseUrl, '/faceset/removeface', removeForm);
      if (!res.ok) {
        return json(502, { error: String(res.data?.error_message || 'Failed to remove face from FaceSet.') });
      }
      return json(200, { removed: true, face_removed: res.data?.face_removed ?? 0 });
    }

    return json(400, { error: 'Unsupported face intelligence action.' });
  } catch (err) {
    return json(502, {
      error: err instanceof Error ? err.message : 'Face intelligence request could not be completed.',
    });
  }
}

