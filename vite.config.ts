import path from 'path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin, type ViteDevServer } from 'vite';
import { issueAgencyAccount } from './api/agency-accounts';
import { compareFaces } from './api/face-compare';
import { handleFaceIntelligence } from './api/face-intelligence';

function mountPostApi(
  server: Pick<ViteDevServer, 'middlewares'>,
  route: string,
  maxBytes: number,
  handler: (req: Request) => Promise<Response>,
  fallbackError: string,
) {
  server.middlewares.use(route, async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' }).end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        const buffer = Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > maxBytes) {
          res.writeHead(413, { 'Content-Type': 'application/json' }).end(
            JSON.stringify({ error: 'Uploaded request payload is too large.' }),
          );
          return;
        }
        chunks.push(buffer);
      }

      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(', '));
      }

      const rawBody = new Uint8Array(Buffer.concat(chunks));
      const webRequest = new Request(`http://localhost${route}`, {
        method: 'POST',
        headers,
        body: rawBody,
      });

      const response = await handler(webRequest);
      res.writeHead(response.status, Object.fromEntries(response.headers)).end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: fallbackError }));
    }
  });
}

function localAgencyApi(mode: string): Plugin {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const configure = (server: Pick<ViteDevServer, 'middlewares'>) => {
    mountPostApi(
      server,
      '/api/agency-accounts',
      4096,
      (req) => issueAgencyAccount(req, env, true),
      'Account issuance is unavailable.',
    );
    mountPostApi(
      server,
      '/api/face-compare',
      3_500_000,
      (req) => compareFaces(req, env),
      'Face comparison is unavailable.',
    );
    mountPostApi(
      server,
      '/api/face-intelligence',
      3_500_000,
      (req) => handleFaceIntelligence(req, env),
      'Face intelligence is unavailable.',
    );
  };
  return {
    name: 'local-agency-api',
    configureServer: configure,
    configurePreviewServer: configure,
  };
}

export default defineConfig(({ mode }) => ({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [react(), localAgencyApi(mode)],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: ['**/node_modules/**', '**/dist/**', '**/.vercel/**'],
  },
}));
