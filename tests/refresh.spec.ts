import { test, expect, type Page } from 'playwright/test';

// Browser-driven coverage for "Refresh nutrition data" (Phase 3.6, Settings
// button): src/nutrition/refresh.ts wired into src/components/Settings.tsx.
// Re-fetches every nutritionSource:'usda' foodCatalog row from the (mocked)
// USDA proxy, then re-blends every nutritionSource:'recipe' row from its
// components' now-fresh per100 -- manual/none rows are never touched. See
// tests/manual-nutrition.spec.ts for the raw-IndexedDB seeding/reading style
// this file follows (no Dexie import available in the browser context).

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
 *  context. Mirrors readFoodCatalog's raw-IDB style in manual-nutrition.spec.ts. */
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
 *  getUsdaFood -> GET /api/usda/food/:fdcId), branching per fdcId so a single
 *  route handler can make one fdcId succeed with a specific nutrient payload
 *  while another fails (e.g. simulating a network/API error). fdcIds not
 *  listed in `byFdcId` are never expected to be requested (refresh.ts only
 *  calls this for nutritionSource:'usda' rows) and 404 if hit anyway. */
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
    description: 'Refreshed Food',
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

test.describe('Refresh nutrition data (Settings)', () => {
  test('re-fetches a stale usda-sourced row and bumps its per100/updatedAt', async ({ page }) => {
    await page.goto('/');
    await mockUsdaFood(page, {
      111: { status: 200, body: fdcFoodResponse(111, { kcal: 120, protein_g: 2, sugar_g: 8 }) },
    });
    await seedFoodCatalog(page, [
      baseRow({
        id: 'row-usda-1',
        name: 'Stale USDA Food',
        fdcId: 111,
        nutritionSource: 'usda',
        per100: { kcal: 90 }, // missing sugar_g -- the gap this feature exists to fix
        servingGrams: 30,
      }),
    ]);

    const message = await clickRefresh(page);
    expect(message).toContain('Updated 1 food');

    const rows = await readFoodCatalogById(page);
    const row = rows['row-usda-1'];
    expect(row.per100?.kcal).toBe(120);
    expect(row.per100?.protein_g).toBe(2);
    expect(row.per100?.sugar_g).toBe(8); // the previously-missing nutrient now present
    expect(row.servingGrams).toBe(50);
    expect(row.updatedAt).not.toBe(OLD_TIMESTAMP);
    expect(row.lastFetchedAt).toBeTruthy();
  });

  test('re-blends a recipe row after its component gets refreshed, using the refreshed per100', async ({ page }) => {
    await page.goto('/');
    await mockUsdaFood(page, {
      111: { status: 200, body: fdcFoodResponse(111, { kcal: 120, protein_g: 2, sugar_g: 8 }) },
    });
    await seedFoodCatalog(page, [
      baseRow({
        id: 'row-usda-1',
        name: 'Stale USDA Food',
        fdcId: 111,
        nutritionSource: 'usda',
        per100: { kcal: 90 },
        servingGrams: 30,
      }),
      baseRow({
        id: 'row-recipe-1',
        name: 'Recipe of Stale Food',
        nutritionSource: 'recipe',
        per100: { kcal: 5 }, // stale blended value from before the component's refresh
        recipeComponents: [{ catalogId: 'row-usda-1', grams: 100 }], // single 100g component
      }),
    ]);

    const message = await clickRefresh(page);
    expect(message).toContain('Updated 1 food');
    expect(message).toContain('re-blended 1 recipe');

    const rows = await readFoodCatalogById(page);
    const component = rows['row-usda-1'];
    const recipe = rows['row-recipe-1'];
    // A single 100g component means blendPer100 reproduces the component's
    // own per100 values exactly for every key the component has (see
    // src/nutrition/blend.ts: acc = per100[key] * grams / 100, divided back
    // by totalGrams=100 and multiplied by 100 -- a no-op at 100g).
    expect(recipe.per100?.kcal).toBe(component.per100?.kcal);
    expect(recipe.per100?.protein_g).toBe(component.per100?.protein_g);
    expect(recipe.per100?.sugar_g).toBe(component.per100?.sugar_g);
    expect(recipe.per100?.kcal).toBe(120);
    expect(recipe.updatedAt).not.toBe(OLD_TIMESTAMP);
  });

  test('leaves a manual-sourced row completely untouched, even alongside usda rows and with an fdcId-like field set', async ({ page }) => {
    await page.goto('/');
    await mockUsdaFood(page, {
      111: { status: 200, body: fdcFoodResponse(111, { kcal: 120, protein_g: 2, sugar_g: 8 }) },
    });
    const manualPer100 = { kcal: 200, protein_g: 5 };
    await seedFoodCatalog(page, [
      baseRow({
        id: 'row-usda-1',
        name: 'Stale USDA Food',
        fdcId: 111,
        nutritionSource: 'usda',
        per100: { kcal: 90 },
      }),
      baseRow({
        id: 'row-manual-1',
        name: 'Manual Food',
        fdcId: 999, // present but must be ignored -- source gate is nutritionSource, not fdcId
        nutritionSource: 'manual',
        per100: { ...manualPer100 },
      }),
    ]);

    const message = await clickRefresh(page);
    expect(message).toContain('Updated 1 food'); // the usda row did update -- proves refresh actually ran

    const rows = await readFoodCatalogById(page);
    const manual = rows['row-manual-1'];
    expect(manual.per100).toEqual(manualPer100); // untouched
    expect(manual.updatedAt).toBe(OLD_TIMESTAMP); // untouched
    expect(manual.lastFetchedAt).toBeUndefined(); // never fetched

    const usda = rows['row-usda-1'];
    expect(usda.per100?.sugar_g).toBe(8); // sanity: the usda row really did refresh
  });

  test('a failed fetch is counted, leaves that row untouched, and other rows still update', async ({ page }) => {
    await page.goto('/');
    await mockUsdaFood(page, {
      111: { status: 200, body: fdcFoodResponse(111, { kcal: 120, protein_g: 2, sugar_g: 8 }) },
      222: { status: 500 }, // simulated network/API failure for this one fdcId
    });
    const failingPer100 = { kcal: 10 };
    await seedFoodCatalog(page, [
      baseRow({
        id: 'row-usda-1',
        name: 'Stale USDA Food',
        fdcId: 111,
        nutritionSource: 'usda',
        per100: { kcal: 90 },
      }),
      baseRow({
        id: 'row-usda-2',
        name: 'Unreachable USDA Food',
        fdcId: 222,
        nutritionSource: 'usda',
        per100: { ...failingPer100 },
      }),
    ]);

    const message = await clickRefresh(page);
    expect(message).toContain('Updated 1 food');
    expect(message).toContain('1 failed');

    const rows = await readFoodCatalogById(page);
    const failed = rows['row-usda-2'];
    expect(failed.per100).toEqual(failingPer100); // untouched by the failed fetch
    expect(failed.updatedAt).toBe(OLD_TIMESTAMP);
    expect(failed.lastFetchedAt).toBeUndefined();

    const succeeded = rows['row-usda-1'];
    expect(succeeded.per100?.sugar_g).toBe(8); // other row still refreshed normally
    expect(succeeded.updatedAt).not.toBe(OLD_TIMESTAMP);
  });
});
