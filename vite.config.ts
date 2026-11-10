import path from 'path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin, type ViteDevServer } from 'vite';
import { issueAgencyAccount } from './api/agency-accounts';

function localAgencyApi(mode: string): Plugin {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const configure = (server: Pick<ViteDevServer, 'middlewares'>) => {
    server.middlewares.use('/api/agency-accounts', async (req, res) => {
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
          if (bytes > 4096) {
            res.writeHead(413).end();
            return;
          }
          chunks.push(buffer);
        }
        const response = await issueAgencyAccount(new Request('http://localhost/api/agency-accounts', {
          method: 'POST',
          headers: { Authorization: req.headers.authorization ?? '', 'Content-Type': 'application/json' },
          body: Buffer.concat(chunks).toString('utf8'),
        }), env, true);
        res.writeHead(response.status, Object.fromEntries(response.headers)).end(await response.text());
      } catch {
        res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Account issuance is unavailable.' }));
      }
    });
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
        }
      },
      test: {
        environment: 'jsdom',
        globals: true
      }
}));
