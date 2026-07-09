import { test, expect, type Page } from 'playwright/test';

// Browser-driven coverage for src/nutrition/cascade.ts's multi-level re-blend
// fix (Phase 3.6 follow-up): the OLD refresh.ts re-blended every recipe in a
// single unordered pass, so a 3-level chain (base item -> recipe B contains
// it -> recipe A contains B) wasn't guaranteed to converge in one click if
// the pass visited A before B had been re-blended from the refreshed base
// item. reblendAllRecipes() now processes recipes in dependency order so
// this always converges regardless of iteration order. See
// tests/refresh.spec.ts for the raw-IndexedDB seed/read helper style this
// file copies (no Dexie import available in the browser context).

interface CatalogRow {
  id: string;
  type: 'foodCatalog';
  name: string;
  category: string;
  ingredientIds: string[];
  fdcId?: number;
  per100?: Record<string, number | undefined>;
  servingGrams?: number;
  nutritionSource?: 'usda' | 'manual' | 'none' | 'recipe';
  lastFetchedAt?: string;
  recipeComponents?: { catalogId: string; grams: number; unit?: 'g' | 'ml' }[];
  createdAt: string;
  updatedAt: string;
  deleted: number;
  enteredBy: string;
}

const OLD_TIMESTAMP = '2020-01-01T00:00:00.000Z';

function baseRow(overrides: Partial<CatalogRow> & { id: string; name: string }): CatalogRow {
  return {
    type: 'foodCatalog',
    category: 'other',
    ingredientIds: [],
    createdAt: OLD_TIMESTAMP,
    updatedAt: OLD_TIMESTAMP,
    deleted: 0,
    enteredBy: 'Test',
    ...overrides,
  };
}

/** Writes foodCatalog rows straight into IndexedDB (Dexie's on-disk format is
 *  plain IndexedDB) via `put` -- no Dexie import needed in the browser
 *  context. Mirrors readFoodCatalog's raw-IDB style in refresh.spec.ts. */
async function seedFoodCatalog(page: Page, rows: CatalogRow[]): Promise<void> {
  await page.evaluate((rowsArg) => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('babyTracker');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const database = req.result;
      const tx = database.transaction('foodCatalog', 'readwrite');
      for (const row of rowsArg) tx.objectStore('foodCatalog').put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  }), rows);
}

/** Reads foodCatalog rows straight out of IndexedDB, keyed by id for easy lookup. */
async function readFoodCatalogById(page: Page): Promise<Record<string, CatalogRow>> {
  const rows = await page.evaluate(() => new Promise<CatalogRow[]>((resolve, reject) => {
    const req = indexedDB.open('babyTracker');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const database = req.result;
      const tx = database.transaction('foodCatalog', 'readonly');
      const getAllReq = tx.objectStore('foodCatalog').getAll();
      getAllReq.onsuccess = () => resolve(getAllReq.result as CatalogRow[]);
      getAllReq.onerror = () => reject(getAllReq.error);
    };
  }));
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

/** Mocks the server-side USDA proxy's food-detail endpoint (src/nutrition/usdaClient.ts
 *  getUsdaFood -> GET /api/usda/food/:fdcId). */
async function mockUsdaFood(page: Page, byFdcId: Record<number, { status: number; body?: unknown }>): Promise<void> {
  await page.route('**/api/usda/food/**', (route) => {
    const match = route.request().url().match(/\/food\/(\d+)/);
    const fdcId = match ? Number(match[1]) : NaN;
    const resp = byFdcId[fdcId];
    if (!resp) {
      void route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      return;
    }
    void route.fulfill({
      status: resp.status,
      contentType: 'application/json',
      body: JSON.stringify(resp.status === 200 ? resp.body : { error: 'mocked failure' }),
    });
  });
}

// USDA nutrient ids used below (see src/nutrition/usdaMap.ts USDA_NUTRIENT_MAP):
// 1008 kcal, 1003 protein_g, 2000 sugar_g (Total Sugars).
function fdcFoodResponse(fdcId: number, opts: { kcal: number; protein_g: number; sugar_g: number }) {
  return {
    fdcId,
    description: 'Refreshed Base Food',
    servingSize: 50,
    servingSizeUnit: 'g',
    foodNutrients: [
      { nutrient: { id: 1008 }, amount: opts.kcal },
      { nutrient: { id: 1003 }, amount: opts.protein_g },
      { nutrient: { id: 2000 }, amount: opts.sugar_g },
    ],
  };
}

async function clickRefresh(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Settings' }).click();
  const button = page.getByRole('button', { name: 'Refresh nutrition data' });
  await expect(button).toBeVisible();
  await button.click();
  const messages = page.locator('.hint').filter({ hasText: /Updated \d+ food|failed to refresh|not configured|rejected/i });
  await expect(messages.first()).toBeVisible();
  return messages.first().textContent().then((t) => t ?? '');
}

test.describe('Multi-level recipe re-blend cascade', () => {
  test('a 3-level nested recipe chain (base -> B -> A) converges in one refresh regardless of iteration order', async ({ page }) => {
    await page.goto('/');
    await mockUsdaFood(page, {
      111: { status: 200, body: fdcFoodResponse(111, { kcal: 150, protein_g: 3, sugar_g: 12 }) },
    });
    await seedFoodCatalog(page, [
      baseRow({
        id: 'row-base',
        name: 'Base USDA Food',
        fdcId: 111,
        nutritionSource: 'usda',
        per100: { kcal: 90 }, // stale, pre-refresh
        servingGrams: 30,
      }),
      // Recipe A is seeded BEFORE recipe B in the array, and A depends on B --
      // the exact ordering the old single unordered pass could get wrong.
      baseRow({
        id: 'row-recipe-a',
        name: 'Recipe A (contains B)',
        nutritionSource: 'recipe',
        per100: { kcal: 5 }, // stale
        recipeComponents: [{ catalogId: 'row-recipe-b', grams: 100 }],
      }),
      baseRow({
        id: 'row-recipe-b',
        name: 'Recipe B (contains base)',
        nutritionSource: 'recipe',
        per100: { kcal: 5 }, // stale
        recipeComponents: [{ catalogId: 'row-base', grams: 100 }],
      }),
    ]);

    const message = await clickRefresh(page);
    expect(message).toContain('Updated 1 food');
    expect(message).toContain('re-blended 2 recipe');

    const rows = await readFoodCatalogById(page);
    const base = rows['row-base'];
    const recipeB = rows['row-recipe-b'];
    const recipeA = rows['row-recipe-a'];

    expect(base.per100?.kcal).toBe(150);

    // Single 100g component reproduces the component's own per100 exactly
    // (see blend.ts: a no-op blend at 100g) -- so B must match the refreshed
    // base, and A (containing only B) must match B in turn.
    expect(recipeB.per100?.kcal).toBe(150);
    expect(recipeB.per100?.sugar_g).toBe(12);
    expect(recipeB.updatedAt).not.toBe(OLD_TIMESTAMP);

    expect(recipeA.per100?.kcal).toBe(150);
    expect(recipeA.per100?.sugar_g).toBe(12);
    expect(recipeA.updatedAt).not.toBe(OLD_TIMESTAMP);
  });
});
