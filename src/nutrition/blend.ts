// Pure math for blending several ingredient components into one combined
// per-100g nutrient profile — the core of the recipe/composite-dish feature.
// No I/O here (no db, no fetch); callers (RecipeBuilderSheet) do the Dexie
// reads/writes and pass plain { per100, grams } component data in.
import { NUTRIENT_KEYS } from '../db';
import type { NutrientProfile } from '../db';

export interface BlendResult {
  per100: NutrientProfile;
  totalGrams: number;
  knownCount: number;
  totalCount: number;
}

/** Weighted blend of several components' per-100g nutrient profiles into a
 *  single combined per-100g profile for the resulting dish.
 *
 *  For each nutrient key: sum over components of `(per100[key] ?? 0) * grams
 *  / 100`, then divide by total grams and multiply by 100.
 *
 *  A component with no per100 at all (e.g. a manually-added ingredient with
 *  no USDA/manual nutrition data), or missing an individual nutrient key,
 *  contributes ZERO to that nutrient's numerator — but its grams still count
 *  toward the denominator (totalGrams). This is a deliberate honest
 *  undercount: an ingredient with unknown nutrition dilutes the blend toward
 *  zero rather than being silently dropped from the dish's weight, which
 *  would overstate the resulting per100. Callers should treat the preview as
 *  a lower bound whenever knownCount < totalCount.
 *
 *  Empty input or all-zero-grams input is safe: totalGrams stays 0, per100
 *  is returned as {} (never NaN/Infinity). */
export function blendPer100(
  components: { per100?: NutrientProfile; grams: number }[],
): BlendResult {
  const totalCount = components.length;
  const knownCount = components.filter((c) => c.per100).length;
  const totalGrams = components.reduce((sum, c) => sum + (c.grams > 0 ? c.grams : 0), 0);

  const per100: NutrientProfile = {};
  if (totalGrams > 0) {
    for (const key of NUTRIENT_KEYS) {
      let acc = 0;
      for (const c of components) {
        const grams = c.grams > 0 ? c.grams : 0;
        if (grams === 0) continue;
        acc += (c.per100?.[key] ?? 0) * grams / 100;
      }
      per100[key] = (acc / totalGrams) * 100;
    }
  }

  return { per100, totalGrams, knownCount, totalCount };
}

/** Deduped union of several components' ingredientIds arrays, order-preserving
 *  (first occurrence wins position) — used when saving a recipe's catalog
 *  item so it inherits every component's ingredient links. */
export function unionIngredientIds(componentIngredientIds: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ids of componentIngredientIds) {
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}
