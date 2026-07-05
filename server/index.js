// Sync server entrypoint. Plain ESM, no build step — see docs/ROADMAP.md Phase 1 W2.
// Fastify: registers the /api/sync + /api/health routes, an (empty until Phase 3) USDA
// proxy, and serves the built frontend from ./public with an SPA fallback.
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import syncRoutes from './sync.js';
import usdaRoutes from './usda.js';

if (!process.env.SYNC_TOKEN) {
  // eslint-disable-next-line no-console
  console.error('SYNC_TOKEN env var is required (shared bearer token for /api/sync). Refusing to start.');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 8080;

const fastify = Fastify({
  logger: true,
  bodyLimit: 10 * 1024 * 1024, // 10MB — sync batches can carry many records
});

await fastify.register(syncRoutes);
await fastify.register(usdaRoutes);

await fastify.register(fastifyStatic, {
  root: PUBLIC_DIR,
  index: false, // index.html is served by the SPA-fallback handler below, so we control its headers
  setHeaders(res, filePath) {
    const base = path.basename(filePath);
    if (base === 'index.html' || base === 'sw.js' || base === 'registerSW.js' || base === 'manifest.webmanifest') {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (filePath.split(path.sep).includes('assets')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
});

const indexHtmlPath = path.join(PUBLIC_DIR, 'index.html');

fastify.setNotFoundHandler((request, reply) => {
  const isApiRoute = request.url === '/api' || request.url.startsWith('/api/');
  if (request.raw.method === 'GET' && !isApiRoute && fs.existsSync(indexHtmlPath)) {
    reply.header('Cache-Control', 'no-cache');
    reply.type('text/html');
    reply.send(fs.createReadStream(indexHtmlPath));
    return;
  }
  reply.code(404).send({ error: 'not found' });
});

fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
});
