import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));

import { extractImageCandidates, handleWebCrawler, isPrivateOrUnsafeHostname, parseSafePublicUrl } from './web-crawler';

const ENV = {
  VITE_SUPABASE_URL: 'https://example.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'anon-key',
  FACEPP_API_KEY: 'test-key',
  FACEPP_API_SECRET: 'test-secret',
  FACEPP_REGION: 'US',
};

const WORKSPACE_ID = '10000000-0000-4000-8000-000000000001';

describe('/api/web-crawler production OSINT crawler handler', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('blocks private IPv4, loopback, localhost, and unsafe URLs for SSRF protection', () => {
    expect(isPrivateOrUnsafeHostname('localhost')).toBe(true);
    expect(isPrivateOrUnsafeHostname('127.0.0.1')).toBe(true);
    expect(isPrivateOrUnsafeHostname('10.0.0.5')).toBe(true);
    expect(isPrivateOrUnsafeHostname('169.254.169.254')).toBe(true);
    expect(isPrivateOrUnsafeHostname('192.168.1.1')).toBe(true);
    expect(isPrivateOrUnsafeHostname('::1')).toBe(true);
    expect(parseSafePublicUrl('http://127.0.0.1:8080/admin')).toBeNull();
    expect(parseSafePublicUrl('https://169.254.169.254/latest/meta-data/')).toBeNull();
    expect(parseSafePublicUrl('ftp://example.com/file.jpg')).toBeNull();
    expect(parseSafePublicUrl('https://punchng.com/wanted-news')?.hostname).toBe('punchng.com');
  });

  it('extracts photo candidates from HTML prioritizing og:image and relevant alt labels while skipping icons/svgs', () => {
    const html = `
      <html>
        <head>
          <title>Wanted Bulletin</title>
          <meta property="og:image" content="/images/suspect-og.jpg" />
        </head>
        <body>
          <img src="/assets/logo.svg" alt="Site Logo" />
          <img src="/uploads/wanted-lagos.jpg" alt="Suspect sighted near Apapa" />
          <img src="https://example.org/favicon.ico" alt="icon" />
        </body>
      </html>
    `;
    const extracted = extractImageCandidates(html, new URL('https://agency-news.example.org/report'), 'Apapa');
    expect(extracted.title).toBe('Wanted Bulletin');
    expect(extracted.candidates.map((c) => c.imageUrl)).toEqual([
      'https://agency-news.example.org/uploads/wanted-lagos.jpg',
      'https://agency-news.example.org/images/suspect-og.jpg',
    ]);
  });

  it('rejects unauthenticated requests and viewer roles', async () => {
    const unauth = await handleWebCrawler(new Request('https://app.example.com/api/web-crawler', { method: 'POST' }), ENV);
    expect(unauth.status).toBe(401);

    const supabaseClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }) },
      from: vi.fn((table: string) => {
        const q: any = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({
            error: null,
            data: table === 'lv_memberships' ? { role: 'viewer' } : { id: WORKSPACE_ID },
          }),
        };
        return q;
      }),
    };
    mocks.createClient.mockReturnValue(supabaseClient);

    const req = new Request('https://app.example.com/api/web-crawler', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok', 'X-Workspace-Id': WORKSPACE_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://punchng.com' }),
    });
    const res = await handleWebCrawler(req, ENV);
    expect(res.status).toBe(403);
  });

  it('crawls public HTML, detects faces via Face++, and indexes them into agency FaceSet', async () => {
    const supabaseClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }) },
      from: vi.fn((table: string) => {
        const q: any = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({
            error: null,
            data: table === 'lv_memberships' ? { role: 'admin' } : { id: WORKSPACE_ID },
          }),
        };
        return q;
      }),
    };
    mocks.createClient.mockReturnValue(supabaseClient);

    const jpegBytes = new Uint8Array(3200).fill(7);
    const htmlBody = '<html><head><title>Wanted Bulletin</title></head><body><img src="/mugshot.jpg" alt="John Doe Wanted" /></body></html>';
    globalThis.fetch = vi.fn(async (input: any) => {
      const target = String(input);
      if (target === 'https://public-news.example.org/wanted') {
        return new Response(htmlBody, { status: 200, headers: { 'Content-Type': 'text/html' } });
      }
      if (target === 'https://public-news.example.org/mugshot.jpg') {
        return new Response(jpegBytes, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
      }
      if (target.endsWith('/detect')) {
        return Response.json({
          faces: [{ face_token: 'ftok_crawl_12345', attributes: { facequality: { value: 86.4 }, age: { value: 34 }, gender: { value: 'Male' } } }],
        });
      }
      if (target.endsWith('/faceset/create')) {
        return Response.json({ faceset_token: 'fs_1', face_added: 1 });
      }
      return new Response('Not found', { status: 404 });
    }) as any;

    const req = new Request('https://app.example.com/api/web-crawler', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok', 'X-Workspace-Id': WORKSPACE_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://public-news.example.org/wanted', maxFaces: 3 }),
    });
    const res = await handleWebCrawler(req, ENV);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.images_checked).toBe(1);
    expect(body.faces).toHaveLength(1);
    expect(body.faces[0]).toMatchObject({
      face_token: 'ftok_crawl_12345',
      face_indexed: true,
      label: 'John Doe Wanted',
      source_domain: 'public-news.example.org',
    });
    expect(body.faces[0].image_base64.length).toBeGreaterThan(100);
  });
});

