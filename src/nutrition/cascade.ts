// Topological re-blend cascade for nested recipes (Phase 3.6 bug fix).
// refresh.ts's old single unordered pass over all recipes could re-blend a
// recipe BEFORE one of its own recipe-components had been re-blended, so a
// change several levels deep (a base ingredient inside recipe B inside
// recipe A) wasn't guaranteed to converge in one pass. This module builds a
// reverse-dependency graph (component -> parent recipes that use it) and
// processes recipes in dependency order — components before the recipes that
// use them — so any depth of nesting converges correctly in a single call,
// with cycles guarded against by never re-processing an id.
import { db } from '../db';
import type { FoodCatalogItem, NutrientProfile } from '../db';
import { blendPer100 } from './blend';

/** Shallow-safe deep-equal for NutrientProfile — plain objects of
 *  number|undefined values, so comparing key-by-key (both directions) is
 *  enough; avoids a JSON.stringify key-order footgun. */
function per100Equal(a: NutrientProfile | undefined, b: NutrientProfile | undefined): boolean {
  const av = a ?? {};
  const bv = b ?? {};
  const keys = new Set([...Object.keys(av), ...Object.keys(bv)]);
  for (const key of keys) {
    if ((av as Record<string, number | undefined>)[key] !== (bv as Record<string, number | undefined>)[key]) {
      return false;
    }
  }
  return true;
}

/** Re-blends a single recipe from its components' CURRENT per100 (as found in
 *  `byId`), writing the result only if it actually differs from the recipe's
 *  existing cached per100 — a no-op recompute shouldn't churn `updatedAt` or
 *  generate sync noise. Returns true iff a write happened. */
async function reblendOne(recipe: FoodCatalogItem, byId: Map<string, FoodCatalogItem>): Promise<boolean> {
  const components = (recipe.recipeComponents ?? []).map((c) => ({
    per100: byId.get(c.catalogId)?.per100,
    grams: c.grams,
  }));
  const blended = blendPer100(components);
  if (per100Equal(recipe.per100, blended.per100)) return false;

  const now = new Date().toISOString();
  const updated: FoodCatalogItem = { ...recipe, per100: blended.per100, updatedAt: now };
  await db.foodCatalog.put(updated);
  byId.set(recipe.id, updated); // keep the in-memory map fresh for any dependent processed after this one
  return true;
}

/** Processes `targets` (a subset of all recipes) in dependency order —
 *  a recipe is only re-blended once every recipe it directly depends on
 *  (that is ALSO in `targets`) has already been processed — via repeated
 *  "resolve anything whose dependencies are all resolved" passes (Kahn's
 *  algorithm). `byId` is the full catalog lookup (recipes AND their
 *  non-recipe components), shared and mutated in place as recipes re-blend
 *  so a recipe-of-a-recipe sees its dependency's fresh per100.
 *
 *  Cycle-safe: a recipe is marked processed the moment it's handled, and any
 *  recipe whose dependencies never fully clear (because they form a cycle)
 *  is still re-blended exactly once at the end, using whatever component
 *  data is available at that point — this can't infinite-loop because the
 *  candidate set only ever shrinks. */
async function processInDependencyOrder(
  targets: FoodCatalogItem[],
  byId: Map<string, FoodCatalogItem>,
): Promise<number> {
  const targetIds = new Set(targets.map((r) => r.id));
  const pending = new Map(targets.map((r) => [r.id, r]));
  let reblendedCount = 0;

  while (pending.size > 0) {
    // Anything whose recipe-components are all OUTSIDE the pending set (i.e.
    // already resolved, or not a recipe we're re-blending this pass) is safe
    // to process now.
    let progressed = false;
    for (const [id, recipe] of pending) {
      const depends = (recipe.recipeComponents ?? []).some((c) => targetIds.has(c.catalogId) && pending.has(c.catalogId));
      if (depends) continue;
      if (await reblendOne(recipe, byId)) reblendedCount += 1;
      pending.delete(id);
      progressed = true;
    }
    if (!progressed) {
      // Remaining recipes form a cycle amongst themselves — process each
      // exactly once with whatever data is currently available so we can't
      // infinite-loop; break the tie by taking them in map-iteration order.
      for (const [id, recipe] of pending) {
        if (await reblendOne(recipe, byId)) reblendedCount += 1;
        pending.delete(id);
      }
    }
  }

  return reblendedCount;
}

/** Re-blends EVERY non-deleted recipe in the catalog, in topological order,
 *  so a change anywhere (a USDA re-fetch, a manual edit, a nested recipe
 *  save) converges correctly across any nesting depth in one call. Replaces
 *  refresh.ts's old unordered single-pass loop. Returns the count of recipes
 *  actually re-blended (i.e. whose per100 write happened — an unchanged
 *  recipe doesn't count). */
export async function reblendAllRecipes(): Promise<number> {
  const all = await db.foodCatalog.where('deleted').equals(0).toArray();
  const byId = new Map(all.map((item) => [item.id, item]));
  const recipes = all.filter((c) => c.nutritionSource === 'recipe' && (c.recipeComponents?.length ?? 0) > 0);
  return processInDependencyOrder(recipes, byId);
}

/** Re-blends only the transitive dependents of `changedCatalogIds` — the
 *  cheap path called right after a single item's save, instead of the full
 *  `reblendAllRecipes()` sweep. Builds a reverse index once (component
 *  catalogId -> parent recipe ids that use it) so walking transitive
 *  dependents is O(recipes), not O(recipes²), then re-blends that subset in
 *  the same dependency order. Returns the count actually re-blended. */
export async function reblendDependents(changedCatalogIds: string[]): Promise<number> {
  const all = await db.foodCatalog.where('deleted').equals(0).toArray();
  const byId = new Map(all.map((item) => [item.id, item]));
  const recipes = all.filter((c) => c.nutritionSource === 'recipe' && (c.recipeComponents?.length ?? 0) > 0);

  // Reverse index: component catalogId -> ids of recipes that directly use it.
  const parentsOf = new Map<string, string[]>();
  for (const recipe of recipes) {
    for (const comp of recipe.recipeComponents ?? []) {
      const list = parentsOf.get(comp.catalogId);
      if (list) list.push(recipe.id);
      else parentsOf.set(comp.catalogId, [recipe.id]);
    }
  }

  // BFS/DFS outward from the changed ids to find every transitive dependent.
  const affectedIds = new Set<string>();
  const queue = [...changedCatalogIds];
  while (queue.length > 0) {
    const id = queue.pop()!;
    for (const parentId of parentsOf.get(id) ?? []) {
      if (affectedIds.has(parentId)) continue; // already queued/visited — cycle-safe
      affectedIds.add(parentId);
      queue.push(parentId);
    }
  }

  const targets = recipes.filter((r) => affectedIds.has(r.id));
  return processInDependencyOrder(targets, byId);
}

/** True if adding `candidateComponentId` as a component of `recipeId` would
 *  create a cycle — either directly (`candidateComponentId === recipeId`,
 *  a recipe containing itself), or transitively (`recipeId` is reachable by
 *  walking DOWN from `candidateComponentId`'s own component tree, meaning
 *  candidateComponentId already (indirectly) contains recipeId, so making
 *  recipeId contain candidateComponentId would close a loop). Used by the
 *  recipe builder UI to block picking a component that would create one. */
export async function wouldCreateCycle(recipeId: string, candidateComponentId: string): Promise<boolean> {
  if (candidateComponentId === recipeId) return true;

  const all = await db.foodCatalog.where('deleted').equals(0).toArray();
  const byId = new Map(all.map((item) => [item.id, item]));

  const visited = new Set<string>();
  const stack = [candidateComponentId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (id === recipeId) return true;
    const item = byId.get(id);
    for (const comp of item?.recipeComponents ?? []) stack.push(comp.catalogId);
  }
  return false;
}
