// Client-side NIH DSLD (Dietary Supplement Label Database) lookups, via the
// server proxy in server/usda.js (Bearer-guarded with the shared sync token,
// responses cached forever server-side).
//
// DSLD API docs: https://dsld.od.nih.gov/api-guide (v9; Swagger UI at
// https://api.ods.od.nih.gov/dsld/v9/). USDA FDC deliberately excludes dietary
// supplements, so supplement bottles (vitamin D drops, probiotics, ...) are
// looked up here instead. See server/usda.js for the verified UPC-matching
// strategy (quoted spaced-UPC free-text queries — DSLD has no UPC parameter).
import { db } from '../db';
import type { NutrientProfile } from '../db';

export interface DsldSearchHit {
  id: string;          // DSLD label id (string in search hits, numeric path in /label/:id)
  name: string;
  brand?: string;
  offMarket?: number;  // 1 = product no longer on the market (still useful for label data)
}

export interface NormalizedDsldSupplement {
  name: string;
  brand?: string;
  upc?: string;                // normalized GTIN digits (from upcSku, when it IS a barcode)
  perDose: NutrientProfile;    // nutrients per ONE printed serving (= one default dose)
  defaultDoseAmount?: number;  // e.g. 5 (drops)
  defaultDoseUnit?: string;    // e.g. 'drops'
  dsldId?: number;
}

// ---- Raw DSLD JSON shapes (only the fields this module reads) ----

interface RawDsldSearchResponse {
  hits?: {
    _id?: string | number;
    _source?: { fullName?: string; brandName?: string; offMarket?: number };
  }[];
}

interface RawDsldQuantity {
  servingSizeOrder?: number;
  quantity?: number;
  unit?: string;
}

interface RawDsldIngredientRow {
  name?: string;
  ingredientGroup?: string;
  description?: string;
  quantity?: RawDsldQuantity[];
  // nestedRows exist on blends; deliberately ignored (blend contents rarely
  // carry clean per-serving amounts and never map to our profile keys).
}

export interface RawDsldLabel {
  id?: number;
  fullName?: string;
  brandName?: string;
  upcSku?: string;
  servingSizes?: { order?: number; minQuantity?: number; maxQuantity?: number; unit?: string }[];
  ingredientRows?: RawDsldIngredientRow[];
}

function baseUrl(): string {
  return (localStorage.getItem('syncUrl') ?? '').trim().replace(/\/+$/, '');
}

async function getJson<T>(path: string): Promise<T> {
  const token = localStorage.getItem('syncToken');
  const res = await fetch(`${baseUrl()}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401) {
    throw new Error('Supplement lookup rejected: check the sync access token in Settings.');
  }
  if (!res.ok) {
    throw new Error(`Supplement lookup failed: HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Search DSLD by product name or scanned UPC digits (the server handles the
 *  barcode-vs-name distinction and DSLD's UPC quirks). */
export async function searchDsld(query: string): Promise<DsldSearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const data = await getJson<RawDsldSearchResponse>(`/api/dsld/search?q=${encodeURIComponent(q)}`);
  const hits = Array.isArray(data.hits) ? data.hits : [];
  return hits
    .filter((h) => h && h._id !== undefined)
    .map((h) => ({
      id: String(h._id),
      name: h._source?.fullName ?? 'Unknown supplement',
      brand: h._source?.brandName || undefined,
      offMarket: h._source?.offMarket,
    }));
}

/** Full DSLD label detail (raw JSON) for one label id. */
export async function getDsldLabel(id: string | number): Promise<RawDsldLabel> {
  return getJson<RawDsldLabel>(`/api/dsld/label/${encodeURIComponent(String(id))}`);
}

// ---- Label -> NutrientProfile normalization ----

// DSLD ingredient rows are matched to profile keys on `ingredientGroup` first
// (DSLD's own canonical grouping, e.g. "Vitamin D" for a "Vitamin D3 (as
// Cholecalciferol)" row), falling back to the row name with any "(as ...)"
// parenthetical stripped. Anything not in this table (niacin, B6, probiotic
// blends, botanical extracts, ...) is skipped rather than guessed at.
const DSLD_NAME_MAP: Record<string, keyof NutrientProfile> = {
  'calories': 'kcal',
  'protein': 'protein_g',
  'total fat': 'fat_g',
  'total carbohydrate': 'carbs_g',
  'total carbohydrates': 'carbs_g',
  'carbohydrate': 'carbs_g',
  'dietary fiber': 'fiber_g',
  'total dietary fiber': 'fiber_g',
  'fiber': 'fiber_g',
  'iron': 'iron_mg',
  'calcium': 'calcium_mg',
  'zinc': 'zinc_mg',
  'vitamin d': 'vitD_ug',
  'vitamin d3': 'vitD_ug',
  'vitamin d2': 'vitD_ug',
  'vitamin c': 'vitC_mg',
  'vitamin a': 'vitA_ug_rae',
  'potassium': 'potassium_mg',
  'sodium': 'sodium_mg',
  'folate': 'folate_ug',
  'folic acid': 'folate_ug',
  'vitamin b12': 'vitB12_ug',
  'vitamin b-12': 'vitB12_ug',
};

// Accepted units per profile key, with multipliers into the key's own unit.
// A row whose unit isn't listed for its key is SKIPPED (never guessed):
// e.g. vitamin A in plain "IU" without a stated retinol form, or a mineral
// in "% DV" only.
//   - vitamin D IU -> µg: ÷40 (1 µg cholecalciferol = 40 IU),
//     https://ods.od.nih.gov/factsheets/VitaminD-HealthProfessional/
//   - vitamin A IU -> µg RAE: ÷3.33 (1 IU retinol = 0.3 µg RAE) — applied
//     ONLY when the row text names a retinol form (retinol/retinyl ester);
//     the beta-carotene IU conversion differs, so unspecified IU is skipped.
//     https://ods.od.nih.gov/factsheets/VitaminA-HealthProfessional/
const GRAM_UNITS: Record<string, number> = { 'g': 1, 'gram': 1, 'grams': 1, 'gram(s)': 1 };
const MG_UNITS: Record<string, number> = { 'mg': 1, 'milligram': 1, 'milligrams': 1 };
const MCG_UNITS: Record<string, number> = { 'mcg': 1, 'ug': 1, 'µg': 1, 'microgram': 1, 'micrograms': 1 };

const UNIT_FACTORS: Partial<Record<keyof NutrientProfile, Record<string, number>>> = {
  kcal: { '': 1, 'kcal': 1, 'calories': 1, 'calorie': 1 },
  protein_g: GRAM_UNITS,
  fat_g: GRAM_UNITS,
  carbs_g: GRAM_UNITS,
  fiber_g: GRAM_UNITS,
  iron_mg: MG_UNITS,
  calcium_mg: MG_UNITS,
  zinc_mg: MG_UNITS,
  potassium_mg: MG_UNITS,
  sodium_mg: MG_UNITS,
  vitC_mg: MG_UNITS,
  vitD_ug: { ...MCG_UNITS, 'iu': 1 / 40 },
  vitA_ug_rae: { ...MCG_UNITS, 'mcg rae': 1, 'µg rae': 1 }, // IU handled separately (retinol check)
  folate_ug: { ...MCG_UNITS, 'mcg dfe': 1, 'µg dfe': 1 },
  vitB12_ug: MCG_UNITS,
};

const VITAMIN_A_IU_PER_UG_RAE = 3.33; // retinol only — see UNIT_FACTORS comment

function normKey(s: string | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

/** Strips "(as Cholecalciferol)"-style parentheticals from a row name. */
function stripParenthetical(name: string): string {
  return name.replace(/\s*\([^)]*\)/g, '').trim();
}

function profileKeyForRow(row: RawDsldIngredientRow): keyof NutrientProfile | undefined {
  return DSLD_NAME_MAP[normKey(row.ingredientGroup)]
    ?? DSLD_NAME_MAP[normKey(stripParenthetical(row.name ?? ''))];
}

/** True when a vitamin A row's text names a retinol form, making the IU ->
 *  µg RAE ÷3.33 conversion valid (it is NOT valid for beta-carotene). */
function isRetinolForm(row: RawDsldIngredientRow): boolean {
  const text = `${row.name ?? ''} ${row.description ?? ''}`.toLowerCase();
  return /retin(ol|yl)/.test(text);
}

/** Normalized GTIN digits from DSLD's upcSku display string ("0 49100 40053 2"
 *  -> "049100400532"). Returns undefined for non-barcode SKUs (e.g. Amazon
 *  "X002FAT3RF") — 8-14 digits is the plausible EAN-8..GTIN-14 range. */
export function upcFromUpcSku(upcSku: string | undefined): string | undefined {
  const digits = (upcSku ?? '').replace(/\s/g, '');
  return /^\d{8,14}$/.test(digits) ? digits : undefined;
}

/** Maps a DSLD label detail JSON to {name, brand, upc?, perDose} plus the
 *  printed serving as the default dose. perDose is the nutrients delivered by
 *  ONE serving as printed on the label (DSLD quantities are per full serving,
 *  e.g. "16 mg per 2 capsules" arrives as quantity=16, servingSizeQuantity=2).
 *  Rows or units that don't map cleanly are skipped, never guessed. */
export function normalizeDsldLabel(json: RawDsldLabel): NormalizedDsldSupplement {
  const perDose: NutrientProfile = {};

  for (const row of json.ingredientRows ?? []) {
    const key = profileKeyForRow(row);
    if (!key) continue;

    // Labels can print several serving sizes (e.g. per age group); use the
    // first (order 1) — it's the primary one and matches servingSizes[0].
    const qty = (row.quantity ?? []).find((q) => (q.servingSizeOrder ?? 1) === 1);
    if (!qty || typeof qty.quantity !== 'number' || Number.isNaN(qty.quantity)) continue;

    const unit = normKey(qty.unit);
    let factor = UNIT_FACTORS[key]?.[unit];
    if (factor === undefined && key === 'vitA_ug_rae' && unit === 'iu' && isRetinolForm(row)) {
      factor = 1 / VITAMIN_A_IU_PER_UG_RAE;
    }
    if (factor === undefined) continue; // unmappable unit — skip, don't guess

    // Same nutrient listed twice (e.g. D3 row + a combined "Vitamin D" row):
    // first mapped row wins; duplicates are skipped rather than summed.
    if (perDose[key] !== undefined) continue;
    perDose[key] = qty.quantity * factor;
  }

  const serving = (json.servingSizes ?? []).find((s) => (s.order ?? 1) === 1);
  const servingAmount = serving?.minQuantity ?? serving?.maxQuantity;
  // "Drop(s)" -> "drops", "Vegetarian Capsule(s)" -> "vegetarian capsules".
  const servingUnit = serving?.unit
    ? serving.unit.replace(/\(s\)/i, 's').toLowerCase()
    : undefined;

  return {
    name: json.fullName || 'Unknown supplement',
    brand: json.brandName || undefined,
    upc: upcFromUpcSku(json.upcSku),
    perDose,
    defaultDoseAmount: typeof servingAmount === 'number' ? servingAmount : undefined,
    defaultDoseUnit: servingUnit,
    dsldId: typeof json.id === 'number' ? json.id : undefined,
  };
}

// ---- UPC -> supplement resolution (local catalog first, then DSLD) ----

/** UPC -> supplement. Checks the local med catalog first (offline repeat-scan
 *  hit), then DSLD via the server proxy. Returns undefined on no match; the
 *  caller (MedLookupSheet) falls back to USDA and then manual entry. */
export async function lookupSupplementByUpc(upc: string): Promise<
  { source: 'local'; catalogId: string } | { source: 'dsld'; supplement: NormalizedDsldSupplement } | undefined
> {
  const digits = upc.replace(/\D/g, '');
  if (!digits) return undefined;

  // Local variants mirror usdaClient.upcVariants: raw, zero-padded-13, stripped.
  const variants = [digits];
  if (digits.length === 12) variants.push(`0${digits}`);
  const stripped = digits.replace(/^0+/, '');
  if (stripped && !variants.includes(stripped)) variants.push(stripped);

  for (const v of variants) {
    const local = await db.medCatalog.where('upc').equals(v).first();
    if (local && local.deleted === 0) return { source: 'local', catalogId: local.id };
  }

  const hits = await searchDsld(digits);
  if (hits.length === 0) return undefined;
  const label = await getDsldLabel(hits[0].id);
  const supplement = normalizeDsldLabel(label);
  // Trust-but-verify: if the label carries a UPC, require it to match the
  // scan (modulo leading zeros); a UPC-less label from a fuzzy text match
  // could otherwise be attributed to the wrong bottle.
  if (supplement.upc && supplement.upc.replace(/^0+/, '') !== stripped) return undefined;
  return { source: 'dsld', supplement };
}
