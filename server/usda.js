// USDA FoodData Central proxy (workstream W4, Phase 3). Bearer-guarded with the
// same SYNC_TOKEN used by /api/sync, so the FDC api_key never reaches the client.
// Caches every response forever in the `usda_cache` table (created by W2 in db.js) —
// FDC's published food data doesn't change once published, so there's no TTL logic.
import { db } from './db.js';

const FDC_BASE = 'https://api.nal.usda.gov/fdc/v1';

const selectCacheStmt = db.prepare('SELECT payload FROM usda_cache WHERE url = ?');
const upsertCacheStmt = db.prepare(`
  INSERT INTO usda_cache (url, payload, fetchedAt)
  VALUES (@url, @payload, @fetchedAt)
  ON CONFLICT(url) DO UPDATE SET payload = excluded.payload, fetchedAt = excluded.fetchedAt
`);

function unauthorized(request) {
  const token = process.env.SYNC_TOKEN;
  const auth = request.headers.authorization || '';
  const match = /^Bearer (.+)$/.exec(auth);
  return !token || !match || match[1] !== token;
}

// A pure-digit query (6-14 digits covers UPC-E through GTIN-14) is a barcode scan,
// not free text — restrict the FDC search to Branded foods (the only dataType with
// a gtinUpc field) so a UPC never matches an unrelated Foundation/SR Legacy food.
function isBarcodeQuery(q) {
  return /^\d{6,14}$/.test(q);
}

/** Cache-forever fetch: serves the cached payload if this exact FDC URL was ever
 *  fetched before, otherwise calls FDC, caches the JSON response, and returns it. */
async function cachedFetch(fastify, cacheKey, fetchUrl) {
  const row = selectCacheStmt.get(cacheKey);
  if (row) {
    fastify.log.info({ cacheKey }, '[usda] cache hit');
    return JSON.parse(row.payload);
  }
  fastify.log.info({ cacheKey }, '[usda] cache miss — fetching FDC');
  const res = await fetch(fetchUrl);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`FDC responded ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  upsertCacheStmt.run({ url: cacheKey, payload: JSON.stringify(data), fetchedAt: new Date().toISOString() });
  return data;
}

function stubResponse(reply) {
  // eslint-disable-next-line no-console
  console.log(
    '[usda] USDA_API_KEY is not set — returning 501 stub. '
    + 'Set USDA_API_KEY in the server environment (see .env.example) to enable USDA FoodData Central lookups. '
    + 'Get a free key at https://fdc.nal.usda.gov/api-key-signup.html',
  );
  return reply.code(501).send({
    error: 'USDA proxy not yet configured',
    hint: 'Set the USDA_API_KEY environment variable on the server, then restart it.',
  });
}

export default async function usdaRoutes(fastify) {
  fastify.get('/api/usda/search', async (request, reply) => {
    if (unauthorized(request)) return reply.code(401).send({ error: 'unauthorized' });
    const apiKey = process.env.USDA_API_KEY;
    if (!apiKey) return stubResponse(reply);

    const q = String(request.query.q || '').trim();
    if (!q) return reply.code(400).send({ error: 'q is required' });

    const barcode = isBarcodeQuery(q);
    const dataType = barcode ? 'Branded' : 'Branded,Foundation,SR Legacy';
    const cacheKey = `search:${dataType}:${q.toLowerCase()}`;
    const fetchUrl = `${FDC_BASE}/foods/search?api_key=${encodeURIComponent(apiKey)}`
      + `&query=${encodeURIComponent(q)}&dataType=${encodeURIComponent(dataType)}`;

    try {
      const data = await cachedFetch(fastify, cacheKey, fetchUrl);
      return data;
    } catch (err) {
      fastify.log.error({ err, q }, '[usda] search failed');
      return reply.code(502).send({ error: 'USDA FDC request failed', detail: String(err.message || err) });
    }
  });

  fastify.get('/api/usda/food/:fdcId', async (request, reply) => {
    if (unauthorized(request)) return reply.code(401).send({ error: 'unauthorized' });
    const apiKey = process.env.USDA_API_KEY;
    if (!apiKey) return stubResponse(reply);

    const fdcId = String(request.params.fdcId || '').trim();
    if (!/^\d+$/.test(fdcId)) return reply.code(400).send({ error: 'fdcId must be numeric' });

    const cacheKey = `food:${fdcId}`;
    const fetchUrl = `${FDC_BASE}/food/${fdcId}?api_key=${encodeURIComponent(apiKey)}`;

    try {
      const data = await cachedFetch(fastify, cacheKey, fetchUrl);
      return data;
    } catch (err) {
      fastify.log.error({ err, fdcId }, '[usda] food lookup failed');
      return reply.code(502).send({ error: 'USDA FDC request failed', detail: String(err.message || err) });
    }
  });
}
