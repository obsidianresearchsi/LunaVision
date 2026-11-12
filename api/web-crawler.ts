import { createClient } from '@supabase/supabase-js';

const UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const MAX_IMAGE_BYTES = 2_000_000;
const MIN_IMAGE_BYTES = 2_500;
const MAX_HTML_BYTES = 1_500_000;

function json(status: number, data: object) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}

function faceppBaseUrl(region: string | undefined): string {
  return region?.trim().toUpperCase() === 'CN'
    ? 'https://api-cn.faceplusplus.com/facepp/v3'
    : 'https://api-us.faceplusplus.com/facepp/v3';
}

function agencyOuterId(workspaceId: string): string {
  return 'lv_' + workspaceId.replace(/-/g, '').toLowerCase();
}

export function isPrivateOrUnsafeHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    return true;
  }
  if (host.includes(':')) {
    // Reject loopback, link-local, unique-local, or mapped IPv6 addresses
    if (
      host === '::' ||
      host === '::1' ||
      host.startsWith('fe80:') ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('::ffff:')
    ) {
      return true;
    }
  }
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, aStr, bStr] = ipv4Match;
    const a = Number(aStr);
    const b = Number(bStr);
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    ) {
      return true;
    }
  }
  return false;
}

export function parseSafePublicUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    if (url.port && url.port !== '80' && url.port !== '443') return null;
    if (isPrivateOrUnsafeHostname(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

async function fetchPublicSafe(
  rawUrl: string,
  accept: string,
  maxBytes: number,
  timeoutMs = 10_000,
): Promise<{ url: URL; contentType: string; bytes: Uint8Array } | null> {
  let current = parseSafePublicUrl(rawUrl);
  if (!current) return null;

  for (let hop = 0; hop < 3; hop++) {
    const res = await fetch(current.href, {
      method: 'GET',
      headers: {
        Accept: accept,
        'User-Agent': 'LunaVisionOSINTCrawler/1.0 (+https://lunavision.vercel.app)',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return null;
      const nextUrl = parseSafePublicUrl(new URL(location, current).href);
      if (!nextUrl) return null;
      current = nextUrl;
      continue;
    }

    if (!res.ok) return null;
    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    const lenHeader = Number(res.headers.get('content-length') || 0);
    if (lenHeader > maxBytes) return null;

    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes || buf.byteLength === 0) return null;
    return { url: current, contentType, bytes: buf };
  }
  return null;
}

function decodeHtmlAttr(val: string): string {
  return val
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

export function extractImageCandidates(
  html: string,
  baseUrl: URL,
  keywordFilter = '',
  limit = 8,
): { title: string; candidates: { imageUrl: string; label: string }[] } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const pageTitle = titleMatch ? decodeHtmlAttr(titleMatch[1].replace(/\s+/g, ' ')) : baseUrl.hostname;
  const kw = keywordFilter.trim().toLowerCase();

  const seen = new Set<string>();
  const rawList: { imageUrl: string; label: string; score: number }[] = [];

  const pushCandidate = (rawSrc: string | undefined, label: string, baseScore: number) => {
    if (!rawSrc) return;
    const cleanSrc = decodeHtmlAttr(rawSrc);
    if (!cleanSrc || cleanSrc.startsWith('data:')) return;
    let resolved: URL | null;
    try {
      resolved = parseSafePublicUrl(new URL(cleanSrc, baseUrl).href);
    } catch {
      resolved = null;
    }
    if (!resolved) return;

    const lower = resolved.href.toLowerCase();
    if (
      lower.includes('favicon') ||
      lower.includes('sprite') ||
      lower.includes('logo') ||
      lower.includes('1x1') ||
      lower.includes('doubleclick') ||
      lower.endsWith('.svg') ||
      lower.endsWith('.ico')
    ) {
      return;
    }
    if (seen.has(resolved.href)) return;
    seen.add(resolved.href);

    let score = baseScore;
    if (kw && (`${label} ${resolved.href}`.toLowerCase().includes(kw))) score += 5;
    if (label.length >= 4) score += 2;
    if (/\.(jpe?g|png|webp)(?:[?#]|$)/i.test(resolved.pathname)) score += 2;
    rawList.push({ imageUrl: resolved.href, label: label || pageTitle, score });
  };

  // 1. OpenGraph & Twitter card preview images
  const metaRe = /<meta\b[^>]*>/gi;
  for (const tag of html.match(metaRe) || []) {
    const prop = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (prop === 'og:image' || prop === 'og:image:url' || prop === 'twitter:image') {
      const content = tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
      pushCandidate(content, pageTitle, 6);
    }
  }

  // 2. <img> tags (src / data-src)
  const imgRe = /<img\b[^>]*>/gi;
  for (const tag of html.match(imgRe) || []) {
    const src =
      tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] ||
      tag.match(/\bdata-src\s*=\s*["']([^"']+)["']/i)?.[1] ||
      tag.match(/\bdata-lazy-src\s*=\s*["']([^"']+)["']/i)?.[1];
    const alt = tag.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] || '';
    pushCandidate(src, decodeHtmlAttr(alt), 4);
  }

  // 3. Direct image <a href="...jpg|png|webp"> links
  const linkRe = /<a\b[^>]*href\s*=\s*["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    pushCandidate(m[1], pageTitle, 3);
  }

  rawList.sort((a, b) => b.score - a.score);
  return {
    title: pageTitle,
    candidates: rawList.slice(0, limit).map(({ imageUrl, label }) => ({ imageUrl, label })),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callFacePP(baseUrl: string, path: string, params: FormData, attempt = 0) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    body: params,
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  });
  const data = await res.json().catch(() => null);
  const errMsg = typeof data?.error_message === 'string' ? data.error_message : '';
  if (errMsg === 'CONCURRENCY_LIMIT_EXCEEDED' && attempt < 2) {
    await sleep(900 * (attempt + 1));
    return callFacePP(baseUrl, path, params, attempt + 1);
  }
  return { ok: res.ok && !errMsg, status: res.status, data };
}

async function ensureAndIndexFace(
  baseUrl: string,
  apiKey: string,
  apiSecret: string,
  outerId: string,
  faceToken: string,
): Promise<boolean> {
  const createForm = new FormData();
  createForm.set('api_key', apiKey);
  createForm.set('api_secret', apiSecret);
  createForm.set('outer_id', outerId);
  createForm.set('display_name', outerId.slice(0, 40));
  createForm.set('face_tokens', faceToken);
  createForm.set('force_merge', '1');
  const res = await callFacePP(baseUrl, '/faceset/create', createForm);
  if (res.ok && Number(res.data?.face_added ?? 1) >= 1) return true;

  const addForm = new FormData();
  addForm.set('api_key', apiKey);
  addForm.set('api_secret', apiSecret);
  addForm.set('outer_id', outerId);
  addForm.set('face_tokens', faceToken);
  const addRes = await callFacePP(baseUrl, '/faceset/addface', addForm);
  return Boolean(addRes.ok && Number(addRes.data?.face_added ?? 0) >= 1);
}

export async function POST(request: Request) {
  return handleWebCrawler(request, process.env);
}

export async function handleWebCrawler(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): Promise<Response> {
  const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return json(401, { error: 'Sign in to operate the web crawler.' });

  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return json(503, { error: 'Workspace authentication is unavailable.' });

  const workspaceId = request.headers.get('x-workspace-id') || '';
  if (!UUID_RE.test(workspaceId)) return json(400, { error: 'Select a valid agency workspace.' });

  const apiKey = env.FACEPP_API_KEY?.trim();
  const apiSecret = env.FACEPP_API_SECRET?.trim();
  if (!apiKey || !apiSecret) return json(503, { error: 'Face++ provider credentials are not configured.' });

  const baseUrl = faceppBaseUrl(env.FACEPP_REGION);

  try {
    const client = createClient(url, key, {
      global: { headers: { Authorization: 'Bearer ' + token } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { data: { user }, error: authErr } = await client.auth.getUser(token);
    if (authErr || !user) return json(401, { error: 'Sign in again to continue.' });

    const [membership, workspace] = await Promise.all([
      client.from('lv_memberships').select('role').eq('workspace_id', workspaceId).eq('user_id', user.id).maybeSingle(),
      client.from('lv_workspaces').select('id').eq('id', workspaceId).eq('kind', 'agency').eq('active', true).maybeSingle(),
    ]);
    if (membership.error || workspace.error) return json(503, { error: 'Agency access could not be verified.' });
    if (!membership.data || !workspace.data) return json(403, { error: 'Active agency membership required.' });

    const role = String((membership.data as any).role || 'member');
    if (!['owner', 'admin', 'supervisor', 'investigator'].includes(role)) {
      return json(403, { error: 'Your role cannot operate web crawler biometric ingestion.' });
    }

    const body = await request.json().catch(() => null);
    const targetUrlRaw = typeof body?.url === 'string' ? body.url.trim() : '';
    const keyword = typeof body?.keyword === 'string' ? body.keyword.trim().slice(0, 80) : '';
    const maxFaces = Math.min(8, Math.max(1, Number(body?.maxFaces || 5)));

    const parsedTarget = parseSafePublicUrl(targetUrlRaw);
    if (!parsedTarget) {
      return json(400, { error: 'Enter a valid public http(s) URL. Private networks and localhost are blocked.' });
    }

    const fetched = await fetchPublicSafe(
      parsedTarget.href,
      'text/html,application/xhtml+xml,image/jpeg,image/png,image/webp,*/*;q=0.8',
      MAX_HTML_BYTES,
      10_000,
    );
    if (!fetched) {
      return json(422, { error: `Could not reach or read public target "${parsedTarget.href}".` });
    }

    let pageTitle = parsedTarget.hostname;
    let candidateList: { imageUrl: string; label: string }[] = [];

    if (fetched.contentType.startsWith('image/')) {
      candidateList = [{ imageUrl: fetched.url.href, label: parsedTarget.hostname }];
    } else {
      const htmlText = new TextDecoder().decode(fetched.bytes);
      const extracted = extractImageCandidates(htmlText, fetched.url, keyword, 10);
      pageTitle = extracted.title;
      candidateList = extracted.candidates;
    }

    const outerId = agencyOuterId(workspaceId);
    const detectedFaces: {
      face_token: string;
      face_indexed: boolean;
      faceset_outer_id: string;
      quality_score: number | null;
      age: number | null;
      gender: string | null;
      label: string;
      image_url: string;
      source_url: string;
      source_domain: string;
      page_title: string;
      image_base64: string;
      content_type: string;
    }[] = [];

    let imagesChecked = 0;
    let skippedNoFace = 0;
    let errors = 0;
    const startedAt = Date.now();

    for (const cand of candidateList) {
      if (detectedFaces.length >= maxFaces || Date.now() - startedAt > 20_000) break;
      imagesChecked++;
      try {
        const imgRes = fetched.contentType.startsWith('image/') && cand.imageUrl === fetched.url.href
          ? fetched
          : await fetchPublicSafe(cand.imageUrl, 'image/jpeg,image/png,image/webp,image/*', MAX_IMAGE_BYTES, 7_000);

        if (!imgRes || imgRes.bytes.byteLength < MIN_IMAGE_BYTES || imgRes.bytes.byteLength > MAX_IMAGE_BYTES) {
          continue;
        }
        const mime = imgRes.contentType.includes('png')
          ? 'image/png'
          : imgRes.contentType.includes('webp')
            ? 'image/webp'
            : 'image/jpeg';
        // Face++ /detect accepts JPEG & PNG directly; skip unsupported WebP if Content-Type is webp unless converted
        if (mime === 'image/webp') continue;

        const detectForm = new FormData();
        detectForm.set('api_key', apiKey);
        detectForm.set('api_secret', apiSecret);
        detectForm.set('image_file', new Blob([Buffer.from(imgRes.bytes)], { type: mime }), mime === 'image/png' ? 'face.png' : 'face.jpg');
        detectForm.set('return_attributes', 'gender,age,facequality');

        const detectRes = await callFacePP(baseUrl, '/detect', detectForm);
        if (!detectRes.ok) {
          errors++;
          continue;
        }

        const faces = Array.isArray(detectRes.data?.faces) ? detectRes.data.faces : [];
        if (faces.length === 0) {
          skippedNoFace++;
          continue;
        }

        const primary = faces[0];
        const faceToken = String(primary.face_token || '');
        if (!faceToken) continue;

        const indexed = await ensureAndIndexFace(baseUrl, apiKey, apiSecret, outerId, faceToken);
        const quality = Number(primary.attributes?.facequality?.value ?? 0);

        detectedFaces.push({
          face_token: faceToken,
          face_indexed: indexed,
          faceset_outer_id: outerId,
          quality_score: Number.isFinite(quality) ? Number(quality.toFixed(1)) : null,
          age: primary.attributes?.age?.value ?? null,
          gender: primary.attributes?.gender?.value ?? null,
          label: cand.label,
          image_url: imgRes.url.href,
          source_url: fetched.url.href,
          source_domain: fetched.url.hostname.replace(/^www\./, ''),
          page_title: pageTitle,
          image_base64: Buffer.from(imgRes.bytes).toString('base64'),
          content_type: mime,
        });
      } catch {
        errors++;
      }
    }

    return json(200, {
      source_url: fetched.url.href,
      source_domain: fetched.url.hostname.replace(/^www\./, ''),
      page_title: pageTitle,
      candidates_found: candidateList.length,
      images_checked: imagesChecked,
      skipped_no_face: skippedNoFace,
      errors,
      faces: detectedFaces,
    });
  } catch (err) {
    return json(502, {
      error: err instanceof Error ? err.message : 'Web crawler scan failed.',
    });
  }
}

