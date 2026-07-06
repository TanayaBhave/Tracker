// Client-side USDA FoodData Central lookups: text search + barcode/UPC resolution.
// Always talks to the server-side proxy (server/usda.js) — the FDC api_key never
// reaches the client. Uses the same syncUrl/syncToken localStorage keys as
// src/sync.ts (same server, same shared bearer token).
import { db } from '../db';
import { normalizeUsdaFood } from './usdaMap';
import type { NormalizedUsdaFood } from './usdaMap';

export type { NormalizedUsdaFood };

export interface UsdaSearchHit {
  fdcId: number;
  description: string;
  brand?: string;
  upc?: string;
}

interface RawSearchResponse {
  foods?: {
    fdcId?: number;
    description?: string;
    brandOwner?: string;
    brandName?: string;
    gtinUpc?: string;
  }[];
}

function baseUrl(): string {
  return (localStorage.getItem('syncUrl') ?? '').trim().replace(/\/+$/, '');
}

async function getJson<T>(path: string): Promise<T> {
  const token = localStorage.getItem('syncToken');
  const res = await fetch(`${baseUrl()}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 501) {
    throw new Error('USDA lookups are not configured on the server yet (missing USDA_API_KEY).');
  }
  if (res.status === 401) {
    throw new Error('USDA lookup rejected: check the sync access token in Settings.');
  }
  if (!res.ok) {
    throw new Error(`USDA request failed: HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Top text-search hits from USDA FDC (Branded, Foundation, SR Legacy), via the
 *  server proxy. A pure-digit query is treated server-side as a barcode search. */
export async function searchUSDA(query: string): Promise<UsdaSearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const data = await getJson<RawSearchResponse>(`/api/usda/search?q=${encodeURIComponent(q)}`);
  const foods = Array.isArray(data.foods) ? data.foods : [];
  return foods.map((f) => ({
    fdcId: Number(f.fdcId),
    description: f.description ?? 'Unknown food',
    brand: f.brandOwner || f.brandName || undefined,
    upc: f.gtinUpc || undefined,
  }));
}

/** Full nutrient profile for one FDC food, normalized to the app's per-100g shape. */
export async function getUsdaFood(fdcId: number): Promise<NormalizedUsdaFood> {
  const data = await getJson<Record<string, unknown>>(`/api/usda/food/${fdcId}`);
  return normalizeUsdaFood(data);
}

// ---- UPC lookup ----

/** Digit variants worth trying for a scanned/typed UPC, in lookup order: the raw
 *  digits, the zero-padded-to-13 GTIN form of a 12-digit UPC-A, and the
 *  leading-zeros-stripped form (covers however a given source chose to store it). */
function upcVariants(raw: string): string[] {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return [];
  const variants = [digits];
  if (digits.length === 12) variants.push(`0${digits}`);
  const stripped = digits.replace(/^0+/, '');
  if (stripped && !variants.includes(stripped)) variants.push(stripped);
  return variants;
}

/** UPC -> nutrient profile. Tries the local foodCatalog first (offline
 *  repeat-purchase hit), then the remote USDA search across normalized UPC
 *  variants (raw, zero-padded-13, leading-zeros-stripped). */
export async function lookupByUpc(upc: string): Promise<NormalizedUsdaFood | undefined> {
  const variants = upcVariants(upc);
  if (variants.length === 0) return undefined;

  for (const v of variants) {
    const local = await db.foodCatalog.where('upc').equals(v).first();
    if (local && local.deleted === 0 && local.per100) {
      return {
        per100: local.per100,
        servingGrams: local.servingGrams,
        brand: local.brand,
        name: local.name,
        fdcId: local.fdcId ?? 0,
        upc: local.upc,
      };
    }
  }

  for (const v of variants) {
    try {
      const data = await getJson<RawSearchResponse>(`/api/usda/search?q=${encodeURIComponent(v)}`);
      const foods = Array.isArray(data.foods) ? data.foods : [];
      const hit = foods.find((f) => (f.gtinUpc ?? '').replace(/^0+/, '') === v.replace(/^0+/, ''));
      if (hit?.fdcId) return await getUsdaFood(hit.fdcId);
    } catch {
      // Try the next UPC variant; if all fail the caller falls back to manual search.
    }
  }
  return undefined;
}
