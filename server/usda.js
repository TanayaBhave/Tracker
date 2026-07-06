// USDA FoodData Central proxy (workstream W4, Phase 3) + NIH DSLD proxy for
// dietary supplements (Phase 3 med/supplement catalog). Bearer-guarded with the
// same SYNC_TOKEN used by /api/sync, so the FDC api_key never reaches the client.
// Caches every response forever in the `usda_cache` table (created by W2 in db.js) —
// FDC's published food data doesn't change once published, so there's no TTL logic.
import { db } from './db.js';

const FDC_BASE = 'https://api.nal.usda.gov/fdc/v1';

// NIH Office of Dietary Supplements — Dietary Supplement Label Database (DSLD).
// API docs: https://dsld.od.nih.gov/api-guide (v9; Swagger UI at
// https://api.ods.od.nih.gov/dsld/v9/). No API key is required (verified: the
// swagger spec declares no auth and unauthenticated requests succeed).
//
// UPC support (verified live against the API, 2026-07): NO endpoint takes a
// dedicated UPC/GTIN parameter — `upcSku` exists only as a response field on
// labels. However, /search-filter's free-text `q` DOES match the upcSku field
// when the query is quoted and formatted the way DSLD stores it, i.e. UPC-A
// display grouping "0 49100 40053 2" (1-5-5-1). A raw digit string like
// 049100400532 returns zero hits; the quoted spaced form returns the label.
// dsldSearchQueries() below builds those quoted variants from scanned digits.
const DSLD_BASE = 'https://api.ods.od.nih.gov/dsld/v9';
const DSLD_SEARCH_SIZE = 20;

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

  // ---- NIH DSLD (dietary supplements) ----
  // Same bearer guard and cache-forever pattern as the USDA routes above, but
  // no API key is needed (see the DSLD_BASE comment). Supplement labels, like
  // FDC foods, don't change once published, so cache-forever is safe here too.

  fastify.get('/api/dsld/search', async (request, reply) => {
    if (unauthorized(request)) return reply.code(401).send({ error: 'unauthorized' });

    const q = String(request.query.q || '').trim();
    if (!q) return reply.code(400).send({ error: 'q is required' });

    try {
      // A scanned barcode needs the quoted spaced-UPC variants; a name query
      // is passed straight through. Try each variant in order and return the
      // first response that actually has hits (an empty last response is
      // still returned so the client sees a well-formed "no results" shape).
      const queries = isBarcodeQuery(q) ? dsldUpcQueries(q) : [q];
      let data = { hits: [] };
      for (const query of queries) {
        const fetchUrl = `${DSLD_BASE}/search-filter?q=${encodeURIComponent(query)}&size=${DSLD_SEARCH_SIZE}`;
        const cacheKey = `dsld-search:${query.toLowerCase()}`;
        data = await cachedFetch(fastify, cacheKey, fetchUrl);
        if (Array.isArray(data.hits) && data.hits.length > 0) break;
      }
      return data;
    } catch (err) {
      fastify.log.error({ err, q }, '[dsld] search failed');
      return reply.code(502).send({ error: 'DSLD request failed', detail: String(err.message || err) });
    }
  });

  fastify.get('/api/dsld/label/:id', async (request, reply) => {
    if (unauthorized(request)) return reply.code(401).send({ error: 'unauthorized' });

    const id = String(request.params.id || '').trim();
    if (!/^\d+$/.test(id)) return reply.code(400).send({ error: 'id must be numeric' });

    const cacheKey = `dsld-label:${id}`;
    const fetchUrl = `${DSLD_BASE}/label/${id}`;

    try {
      const data = await cachedFetch(fastify, cacheKey, fetchUrl);
      return data;
    } catch (err) {
      fastify.log.error({ err, id }, '[dsld] label lookup failed');
      return reply.code(502).send({ error: 'DSLD request failed', detail: String(err.message || err) });
    }
  });
}

/** Quoted free-text queries that can hit DSLD's upcSku field for a scanned
 *  digit string (see the DSLD_BASE comment for why this formatting exists).
 *  Candidates: 13-digit GTIN with leading 0 -> its 12-digit UPC-A core;
 *  12-digit UPC-A as-is. Each candidate is emitted in DSLD's stored display
 *  grouping `"D DDDDD DDDDD D"` first, then as a plain quoted digit string
 *  as a long-shot fallback for labels stored without spaces. */
function dsldUpcQueries(raw) {
  const digits = raw.replace(/\D/g, '');
  const candidates = [];
  if (digits.length === 13 && digits.startsWith('0')) candidates.push(digits.slice(1));
  if (digits.length === 12) candidates.push(digits);
  if (!candidates.includes(digits)) candidates.push(digits);

  const queries = [];
  for (const c of candidates) {
    if (c.length === 12) {
      queries.push(`"${c[0]} ${c.slice(1, 6)} ${c.slice(6, 11)} ${c[11]}"`);
    }
    queries.push(`"${c}"`);
  }
  return queries;
}
