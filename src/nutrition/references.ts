// Reference-counting and merge helpers for the two "delete-adjacent" catalogs:
// db.foodCatalog (plain foods + recipes) and db.ingredients (the ingredient
// tag catalog). A UI can't safely offer "delete this" without first knowing
// who still points at it, and db.ingredients specifically needs a merge path
// (dedupe two user-typed tags into one) that rewrites every referrer inside a
// single transaction so no live record is ever left pointing at a deleted id.
// No UI here — this is a pure data-layer module, same spirit as blend.ts.
import { db } from '../db';

/** How many live (non-deleted) records still point at a foodCatalog row —
 *  used to warn/block before deleting a catalog item. Only counts referrers
 *  the user can currently see; a meal or recipe that's already soft-deleted
 *  isn't a reason to block a delete. */
export async function countFoodCatalogRefs(
  catalogId: string,
): Promise<{ meals: number; recipes: number }> {
  const meals = await db.meals
    .filter((m) => m.deleted === 0 && m.foodItems.some((fi) => fi.catalogId === catalogId))
    .count();
  const recipes = await db.foodCatalog
    .filter((f) =>
      f.deleted === 0 &&
      f.nutritionSource === 'recipe' &&
      (f.recipeComponents ?? []).some((c) => c.catalogId === catalogId))
    .count();
  return { meals, recipes };
}

/** How many live records still point at an ingredient — used to warn/block
 *  before deleting an ingredient, and to size the merge confirmation. */
export async function countIngredientRefs(
  ingredientId: string,
): Promise<{ meals: number; catalogItems: number }> {
  const meals = await db.meals
    .filter((m) => m.deleted === 0 && m.foodItems.some((fi) => fi.ingredientIds.includes(ingredientId)))
    .count();
  const catalogItems = await db.foodCatalog
    .filter((f) => f.deleted === 0 && f.ingredientIds.includes(ingredientId))
    .count();
  return { meals, catalogItems };
}

// Maps loserId -> survivorId within an ids array, then dedupes via Set. This
// also correctly collapses the case where the survivor id was already present
// in the array alongside the loser. Returns the original array reference
// unchanged (not a copy) when loserId isn't present, so callers can cheaply
// detect "nothing changed" via referential equality and skip the write.
function rewriteIds(ids: string[], loserId: string, survivorId: string): string[] {
  if (!ids.includes(loserId)) return ids;
  return [...new Set(ids.map((id) => (id === loserId ? survivorId : id)))];
}

/** Merges two ingredient-catalog tags into one: every live and soft-deleted
 *  reference to `loserId` (in meal foodItems and in foodCatalog rows) is
 *  rewritten to point at `survivorId`, the loser's `tags` are unioned into
 *  the survivor's, and the loser is soft-deleted. Runs as one Dexie
 *  transaction so a crash mid-merge can never strand a live reference
 *  pointing at a deleted ingredient.
 *
 *  Soft-deleted meals are rewritten too (not just live ones) — otherwise
 *  undeleting a meal later could resurrect a dangling reference to the
 *  merged-away tag.
 *
 *  Throws if loserId === survivorId, if either id doesn't exist, or if
 *  either is already deleted — merging only makes sense between two
 *  currently-live tags. */
export async function mergeIngredients(loserId: string, survivorId: string): Promise<void> {
  if (loserId === survivorId) throw new Error('mergeIngredients: loserId and survivorId are the same');

  await db.transaction('rw', db.meals, db.foodCatalog, db.ingredients, async () => {
    const loser = await db.ingredients.get(loserId);
    const survivor = await db.ingredients.get(survivorId);
    if (!loser) throw new Error(`mergeIngredients: loser ${loserId} not found`);
    if (!survivor) throw new Error(`mergeIngredients: survivor ${survivorId} not found`);
    if (loser.deleted === 1) throw new Error(`mergeIngredients: loser ${loserId} is already deleted`);
    if (survivor.deleted === 1) throw new Error(`mergeIngredients: survivor ${survivorId} is already deleted`);

    const now = new Date().toISOString();

    const meals = await db.meals.toArray();
    for (const meal of meals) {
      let changed = false;
      const foodItems = meal.foodItems.map((fi) => {
        const rewritten = rewriteIds(fi.ingredientIds, loserId, survivorId);
        if (rewritten !== fi.ingredientIds) changed = true;
        return rewritten === fi.ingredientIds ? fi : { ...fi, ingredientIds: rewritten };
      });
      if (changed) {
        await db.meals.put({ ...meal, foodItems, updatedAt: now });
      }
    }

    const catalogItems = await db.foodCatalog.toArray();
    for (const item of catalogItems) {
      const rewritten = rewriteIds(item.ingredientIds, loserId, survivorId);
      if (rewritten !== item.ingredientIds) {
        await db.foodCatalog.put({ ...item, ingredientIds: rewritten, updatedAt: now });
      }
    }

    const mergedTags = [...new Set([...survivor.tags, ...loser.tags])];
    await db.ingredients.put({ ...survivor, tags: mergedTags, updatedAt: now });

    await db.ingredients.put({ ...loser, deleted: 1, updatedAt: now });
  });
}
