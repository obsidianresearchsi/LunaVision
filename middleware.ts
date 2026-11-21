// Site-wide lock: intercept pages, static assets, and API calls before the app runs.
// To restore access, remove this file and the siteUnavailable plugin in vite.config.ts.
export const config = { matcher: '/:path*' };

const unavailablePage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow, noarchive">
    <title>404 — App unavailable</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; min-height: 100dvh; display: grid; place-items: center; padding: 32px; background: #fafafa; color: #171717; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { max-width: 440px; text-align: center; }
      .code { margin: 0 0 24px; color: #737373; font: 500 14px ui-monospace, monospace; letter-spacing: .14em; }
      h1 { margin: 0 0 12px; font-size: clamp(24px, 6vw, 32px); font-weight: 600; letter-spacing: -.035em; line-height: 1.2; }
      .message { margin: 0; color: #737373; font-size: 15px; line-height: 1.6; }
    </style>
  </head>
  <body>
    <main>
      <p class="code">404 · NOT FOUND</p>
      <h1>This app is not reachable.</h1>
      <p class="message">The requested page is currently unavailable.</p>
    </main>
  </body>
</html>`;

export default function middleware(request: Request): Response {
  return new Response(request.method === 'HEAD' ? null : unavailablePage, {
    status: 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'CDN-Cache-Control': 'no-store',
      'Vercel-CDN-Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    },
  });
}
