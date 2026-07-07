// USDA FoodData Central nutrient ID -> our NutrientProfile key, plus the JSON
// shape mapper. No network calls here — see usdaClient.ts for that.
//
// FDC reports Branded/Foundation/SR Legacy nutrient amounts per 100 g (or 100 mL)
// of food already, so per100 below needs no unit conversion; intake.ts does the
// per-meal `amountConsumed / 100` scaling.
//
// Response shape note (verified live against the real API during implementation):
// - GET /v1/food/:fdcId (detail) nests each entry as `{ nutrient: { id, unitName }, amount }`.
// - GET /v1/foods/search (search) uses flat `{ nutrientId, unitName, value }`.
// normalizeUsdaFood() below accepts either shape.
import type { NutrientProfile } from '../db';

export const USDA_NUTRIENT_MAP: Record<number, keyof NutrientProfile> = {
  1008: 'kcal',
  1003: 'protein_g',
  1004: 'fat_g',
  1005: 'carbs_g',
  1079: 'fiber_g',
  1089: 'iron_mg',
  1087: 'calcium_mg',
  1095: 'zinc_mg',
  1114: 'vitD_ug',
  1162: 'vitC_mg',
  1106: 'vitA_ug_rae', // RAE only — nutrient 1104 (Vitamin A, RE) is deliberately not used.
  1092: 'potassium_mg',
  1093: 'sodium_mg',
  1177: 'folate_ug', // Folate, total — used only when 1190 (DFE) is absent.
  1190: 'folate_ug', // Folate, DFE — preferred; see FOLATE_DFE_ID handling below.
  1178: 'vitB12_ug',
  // Sugar ids (Phase 3.6) — verified live against the USDA FDC API during
  // implementation (WebFetch/search against api.nal.usda.gov/fdc/v1/foods/search,
  // DEMO_KEY), not from model memory:
  //  - 2000 "Total Sugars" appears on Branded and SR Legacy foods (e.g. fdcId
  //    509818 "KNO" cookies, fdcId 173944 "Bananas, raw").
  //  - 1063 "Sugars, Total NLEA" is Foundation Foods' equivalent (nutrient code
  //    269.3), used only when 2000 is absent — see FDC Foundation Foods docs:
  //    https://fdc.nal.usda.gov/Foundation_Foods_Documentation/
  //  - 1235 "Sugars, added" appears only on Branded foods, e.g. fdcId 2638022
  //    "MEIJER FRESH VANILLA YOGURT PARFAIT" reports both 2000 (14.2g total)
  //    and 1235 (10.8g added) side by side.
  2000: 'sugar_g', // Total Sugars — preferred over 1063 when both present.
  1063: 'sugar_g', // Sugars, Total NLEA — fallback; see SUGAR_TOTAL_ID handling below.
  1235: 'addedSugar_g', // Sugars, added (Branded only) — no precedence conflict, single id.
};

// Vitamin D fallback: some Branded foods carry only the IU form (nutrient 1110,
// "Vitamin D (D2 + D3), International Units") and omit 1114 (the µg form).
// 1 µg cholecalciferol = 40 IU is the standard conversion factor — see
// https://ods.od.nih.gov/factsheets/VitaminD-HealthProfessional/
const VITAMIN_D_UG_ID = 1114;
const VITAMIN_D_IU_ID = 1110;
const IU_PER_UG_VITAMIN_D = 40;

const FOLATE_TOTAL_ID = 1177;
const FOLATE_DFE_ID = 1190;

// Total sugars fallback: Foundation Foods carry only 1063 ("Sugars, Total
// NLEA") while Branded/SR Legacy foods carry 2000 ("Total Sugars"); prefer
// 2000 when both are present. See USDA_NUTRIENT_MAP comment above for the
// verification sources.
const SUGAR_TOTAL_ID = 2000;
const SUGAR_NLEA_ID = 1063;

interface RawFdcNutrient {
  // Detail endpoint (/v1/food/:fdcId) shape.
  nutrient?: { id?: number; unitName?: string };
  amount?: number;
  // Search endpoint (/v1/foods/search) shape.
  nutrientId?: number;
  unitName?: string;
  value?: number;
}

interface RawFdcFood {
  fdcId?: number;
  description?: string;
  brandOwner?: string;
  brandName?: string;
  gtinUpc?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  foodNutrients?: RawFdcNutrient[];
}

function nutrientId(n: RawFdcNutrient): number | undefined {
  return n.nutrient?.id ?? n.nutrientId;
}

function nutrientAmount(n: RawFdcNutrient): number | undefined {
  return n.amount ?? n.value;
}

export interface NormalizedUsdaFood {
  per100: NutrientProfile;
  servingGrams?: number;
  brand?: string;
  name: string;
  fdcId: number;
  upc?: string;
}

/** Maps one FDC food JSON object (from /v1/food/:fdcId, or a /v1/foods/search
 *  result) to the app's per-100g NutrientProfile shape. */
export function normalizeUsdaFood(json: RawFdcFood): NormalizedUsdaFood {
  const nutrients = Array.isArray(json.foodNutrients) ? json.foodNutrients : [];
  const per100: NutrientProfile = {};
  let vitDUg: number | undefined;
  let vitDIu: number | undefined;
  let folateTotal: number | undefined;
  let folateDfe: number | undefined;
  let sugarTotal: number | undefined;
  let sugarNlea: number | undefined;

  for (const n of nutrients) {
    const id = nutrientId(n);
    const amount = nutrientAmount(n);
    if (id === undefined || amount === undefined || Number.isNaN(amount)) continue;

    if (id === VITAMIN_D_UG_ID) vitDUg = amount;
    else if (id === VITAMIN_D_IU_ID) vitDIu = amount;
    else if (id === FOLATE_TOTAL_ID) folateTotal = amount;
    else if (id === FOLATE_DFE_ID) folateDfe = amount;
    else if (id === SUGAR_TOTAL_ID) sugarTotal = amount;
    else if (id === SUGAR_NLEA_ID) sugarNlea = amount;

    const key = USDA_NUTRIENT_MAP[id];
    // vitD_ug, folate_ug, and sugar_g need the precedence logic below, applied
    // once after the loop, instead of a last-write-wins assignment during
    // iteration (both 2000 and 1063 map to sugar_g).
    if (key && key !== 'vitD_ug' && key !== 'folate_ug' && key !== 'sugar_g') {
      per100[key] = amount;
    }
  }

  per100.vitD_ug = vitDUg ?? (vitDIu !== undefined ? vitDIu / IU_PER_UG_VITAMIN_D : undefined);
  per100.folate_ug = folateDfe ?? folateTotal;
  per100.sugar_g = sugarTotal ?? sugarNlea;

  const servingSizeUnit = (json.servingSizeUnit ?? '').toLowerCase();
  const servingGrams = typeof json.servingSize === 'number' && (servingSizeUnit === 'g' || servingSizeUnit === 'ml')
    ? json.servingSize
    : undefined;

  return {
    per100,
    servingGrams,
    brand: json.brandOwner || json.brandName || undefined,
    name: json.description || 'Unknown food',
    fdcId: Number(json.fdcId),
    upc: json.gtinUpc || undefined,
  };
}
