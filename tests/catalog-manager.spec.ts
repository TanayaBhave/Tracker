import { test, expect, type Page, type Locator } from 'playwright/test';

// Browser-driven coverage for src/components/CatalogManagerSheet.tsx (Settings
// > "Manage foods & ingredients"): lets a parent edit/delete saved
// foods/recipes and ingredient tags, blocking deletes that would strand a
// live reference and offering a merge path for duplicate ingredient tags.
// Backed by src/nutrition/references.ts's countFoodCatalogRefs /
// countIngredientRefs / mergeIngredients. Runs against `npm run preview`
// (dist/) per playwright.config.ts webServer -- seed/read helpers below
// mirror the raw-IndexedDB style established in tests/refresh.spec.ts and
// tests/manual-nutrition.spec.ts (no Dexie import available in the browser
// context).

interface CatalogRow {
  id: string;
  type: 'foodCatalog';
  name: string;
  category: string;
  ingredientIds: string[];
  brand?: string;
  nutritionSource?: 'usda' | 'manual' | 'none' | 'recipe';
  recipeComponents?: { catalogId: string; grams: number; unit?: 'g' | 'ml' }[];
  createdAt: string;
  updatedAt: string;
  deleted: number;
  enteredBy: string;
}

interface MealFoodItem {
  name: string;
  category: string;
  ingredientIds: string[];
  catalogId?: string;
}

interface MealRow {
  id: string;
  type: 'meal';
  timestamp: string;
  foodItems: MealFoodItem[];
  oralMotorTags: string[];
  reaction: string;
  createdAt: string;
  updatedAt: string;
  deleted: number;
  enteredBy: string;
}

interface IngredientRow {
  id: string;
  type: 'ingredient';
  name: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  deleted: number;
  enteredBy: string;
}

const OLD_TIMESTAMP = '2020-01-01T00:00:00.000Z';

function baseFoodRow(overrides: Partial<CatalogRow> & { id: string; name: string }): CatalogRow {
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

function baseMealRow(overrides: Partial<MealRow> & { id: string; foodItems: MealFoodItem[] }): MealRow {
  return {
    type: 'meal',
    timestamp: OLD_TIMESTAMP,
    oralMotorTags: [],
    reaction: 'none',
    createdAt: OLD_TIMESTAMP,
    updatedAt: OLD_TIMESTAMP,
    deleted: 0,
    enteredBy: 'Test',
    ...overrides,
  };
}

function baseIngredientRow(overrides: Partial<IngredientRow> & { id: string; name: string }): IngredientRow {
  return {
    type: 'ingredient',
    tags: [],
    createdAt: OLD_TIMESTAMP,
    updatedAt: OLD_TIMESTAMP,
    deleted: 0,
    enteredBy: 'Test',
    ...overrides,
  };
}

/** Generic raw-IndexedDB seed helper -- writes rows straight into a given
 *  object store via `put` (Dexie's on-disk format is plain IndexedDB), no
 *  Dexie import needed in the browser context. Mirrors seedFoodCatalog's
 *  style in tests/refresh.spec.ts, parameterized by store name so it covers
 *  foodCatalog/meals/ingredients alike. */
async function seedStore<T>(page: Page, storeName: string, rows: T[]): Promise<void> {
  await page.evaluate(({ storeName: name, rowsArg }) => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('babyTracker');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const database = req.result;
      const tx = database.transaction(name, 'readwrite');
      for (const row of rowsArg) tx.objectStore(name).put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  }), { storeName, rowsArg: rows });
}

/** Generic raw-IndexedDB read-all helper, keyed by id for easy lookup.
 *  Mirrors readFoodCatalogById's style in tests/refresh.spec.ts. */
async function readStoreById<T extends { id: string }>(page: Page, storeName: string): Promise<Record<string, T>> {
  const rows = await page.evaluate((name) => new Promise<T[]>((resolve, reject) => {
    const req = indexedDB.open('babyTracker');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const database = req.result;
      const tx = database.transaction(name, 'readonly');
      const getAllReq = tx.objectStore(name).getAll();
      getAllReq.onsuccess = () => resolve(getAllReq.result as T[]);
      getAllReq.onerror = () => reject(getAllReq.error);
    };
  }), storeName);
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

function seedFoodCatalog(page: Page, rows: CatalogRow[]) { return seedStore(page, 'foodCatalog', rows); }
function readFoodCatalogById(page: Page) { return readStoreById<CatalogRow>(page, 'foodCatalog'); }
function seedMeals(page: Page, rows: MealRow[]) { return seedStore(page, 'meals', rows); }
function readMealsById(page: Page) { return readStoreById<MealRow>(page, 'meals'); }
function seedIngredients(page: Page, rows: IngredientRow[]) { return seedStore(page, 'ingredients', rows); }
function readIngredientsById(page: Page) { return readStoreById<IngredientRow>(page, 'ingredients'); }

/** The catalog manager sheet is a DOM sibling overlay, same pattern as other
 *  custom (non-<Sheet>) screens -- scope by its <h2> title so `.entry` rows
 *  underneath in Settings ("Stored locally" also uses .entry) never collide
 *  with rows inside this sheet. See sheetByTitle in tests/manual-nutrition.spec.ts. */
function sheetByTitle(page: Page, title: string): Locator {
  return page.locator('.sheet').filter({ has: page.locator('h2', { hasText: title }) });
}

async function openManageSheet(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Manage foods & ingredients' }).click();
  const sheet = sheetByTitle(page, 'Manage foods & ingredients');
  await expect(sheet).toBeVisible();
  return sheet;
}

function rowFor(sheet: Locator, name: string): Locator {
  return sheet.locator('.entry').filter({ hasText: name });
}

test.describe('Catalog manager (Settings > Manage foods & ingredients)', () => {
  test('a foodCatalog row referenced by a meal cannot be deleted', async ({ page }) => {
    await page.goto('/');
    await seedFoodCatalog(page, [
      baseFoodRow({ id: 'food-ref-1', name: 'Referenced Food', nutritionSource: 'manual' }),
    ]);
    await seedMeals(page, [
      baseMealRow({
        id: 'meal-1',
        foodItems: [{ name: 'Referenced Food', category: 'other', ingredientIds: [], catalogId: 'food-ref-1' }],
      }),
    ]);

    const sheet = await openManageSheet(page);
    await sheet.locator('input[placeholder="Filter by name…"]').fill('Referenced Food');
    const row = rowFor(sheet, 'Referenced Food');
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Delete' }).click();

    await expect(row.locator('.warn-banner')).toHaveText(
      "Can't delete — used in 1 meal. Remove it from those first.",
    );
    await expect(row).toBeVisible(); // still in the list -- not deleted

    const rows = await readFoodCatalogById(page);
    expect(rows['food-ref-1'].deleted).toBe(0);
  });

  test('a foodCatalog row with zero references deletes successfully', async ({ page }) => {
    await page.goto('/');
    await seedFoodCatalog(page, [
      baseFoodRow({ id: 'food-noref-1', name: 'Unreferenced Food', nutritionSource: 'manual' }),
    ]);

    const sheet = await openManageSheet(page);
    await sheet.locator('input[placeholder="Filter by name…"]').fill('Unreferenced Food');
    const row = rowFor(sheet, 'Unreferenced Food');
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Delete' }).click();

    await expect(row).toHaveCount(0); // removed from the live-query list once deleted

    const rows = await readFoodCatalogById(page);
    expect(rows['food-noref-1'].deleted).toBe(1);
  });

  test('an ingredient referenced by a meal cannot be deleted', async ({ page }) => {
    await page.goto('/');
    await seedIngredients(page, [
      baseIngredientRow({ id: 'ing-ref-1', name: 'Referenced Ingredient' }),
    ]);
    await seedMeals(page, [
      baseMealRow({
        id: 'meal-2',
        foodItems: [{ name: 'Something', category: 'other', ingredientIds: ['ing-ref-1'] }],
      }),
    ]);

    const sheet = await openManageSheet(page);
    await sheet.getByRole('button', { name: 'Ingredient tags' }).click();
    await sheet.locator('input[placeholder="Filter by name…"]').fill('Referenced Ingredient');
    const row = rowFor(sheet, 'Referenced Ingredient');
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Delete' }).click();

    await expect(row.locator('.warn-banner')).toHaveText(
      "Can't delete — used in 1 meal. Remove it from those first.",
    );
    await expect(row).toBeVisible();

    const rows = await readIngredientsById(page);
    expect(rows['ing-ref-1'].deleted).toBe(0);
  });

  test('merging two ingredients rewrites a meal\'s ingredientIds and soft-deletes the loser', async ({ page }) => {
    await page.goto('/');
    await seedIngredients(page, [
      baseIngredientRow({ id: 'ing-loser-1', name: 'Loser Ingredient' }),
      baseIngredientRow({ id: 'ing-survivor-1', name: 'Survivor Ingredient' }),
    ]);
    await seedMeals(page, [
      baseMealRow({
        id: 'meal-3',
        foodItems: [{ name: 'Something', category: 'other', ingredientIds: ['ing-loser-1'] }],
      }),
    ]);

    const sheet = await openManageSheet(page);
    await sheet.getByRole('button', { name: 'Ingredient tags' }).click();
    await sheet.locator('input[placeholder="Filter by name…"]').fill('Loser Ingredient');
    const row = rowFor(sheet, 'Loser Ingredient');
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Merge into…' }).click();
    await row.locator('input[placeholder="Search ingredient to merge into…"]').fill('Survivor');
    await row.getByRole('button', { name: 'Survivor Ingredient' }).click();

    await expect(row).toHaveCount(0); // loser row disappears once soft-deleted

    const meals = await readMealsById(page);
    expect(meals['meal-3'].foodItems[0].ingredientIds).toEqual(['ing-survivor-1']);

    const ingredients = await readIngredientsById(page);
    expect(ingredients['ing-loser-1'].deleted).toBe(1);
    expect(ingredients['ing-survivor-1'].deleted).toBe(0);
  });
});
