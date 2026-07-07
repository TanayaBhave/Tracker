// "Refresh nutrition data" (Phase 3.6, Settings button): foods scanned before
// a nutrient was added (e.g. sugar) have a stale per100 missing it. This
// re-fetches every USDA-sourced catalog item from the (cheap, server-cached)
// USDA proxy, then re-blends every recipe from its components' now-fresh
// per100 values. Manual/none-source items are never touched — there's
// nothing to re-fetch, and a hand-typed label shouldn't be silently
// overwritten by a network call.
import { db } from '../db';
import { getUsdaFood } from './usdaClient';
import { blendPer100 } from './blend';

export interface RefreshResult {
  /** USDA-sourced catalog items successfully re-fetched. */
  updated: number;
  /** Recipe catalog items successfully re-blended from their components. */
  reblended: number;
  /** USDA-sourced items whose re-fetch failed (network/offline/API error) — skipped, left untouched. */
  failed: number;
}

/** Re-fetches per100/servingGrams for every non-deleted foodCatalog item with
 *  an fdcId and nutritionSource:'usda', then re-blends every
 *  nutritionSource:'recipe' item from its recipeComponents (which resolve
 *  each component's CURRENT per100 — including nutrients any freshly-fetched
 *  component just gained). Only writes a USDA item after its fetch succeeds,
 *  so a failure (offline, server not configured, etc.) never corrupts
 *  existing data; failures are counted and skipped, not thrown. */
export async function refreshNutritionData(): Promise<RefreshResult> {
  let updated = 0;
  let failed = 0;

  const items = await db.foodCatalog.where('deleted').equals(0).toArray();
  for (const item of items) {
    if (item.nutritionSource !== 'usda' || !item.fdcId) continue;
    try {
      const food = await getUsdaFood(item.fdcId);
      const now = new Date().toISOString();
      await db.foodCatalog.put({
        ...item,
        per100: food.per100,
        servingGrams: food.servingGrams,
        lastFetchedAt: now,
        updatedAt: now,
      });
      updated += 1;
    } catch {
      failed += 1; // fail soft — leave this item's existing data untouched, try the next one
    }
  }

  // Re-blend recipes AFTER the USDA refresh loop above so a recipe built from
  // a just-refreshed component picks up its new nutrients (e.g. sugar) too.
  let reblended = 0;
  const recipes = (await db.foodCatalog.where('deleted').equals(0).toArray())
    .filter((c) => c.nutritionSource === 'recipe' && (c.recipeComponents?.length ?? 0) > 0);

  for (const recipe of recipes) {
    const components = await Promise.all(
      (recipe.recipeComponents ?? []).map(async (c) => {
        const dish = await db.foodCatalog.get(c.catalogId);
        return { per100: dish?.per100, grams: c.grams };
      }),
    );
    const blended = blendPer100(components);
    await db.foodCatalog.put({
      ...recipe,
      per100: blended.per100,
      updatedAt: new Date().toISOString(),
    });
    reblended += 1;
  }

  return { updated, reblended, failed };
}
