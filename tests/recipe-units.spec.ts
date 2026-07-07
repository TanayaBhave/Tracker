import { test, expect, type Page, type Locator } from 'playwright/test';

// Coverage for the per-ingredient g/mL unit chip and "Total dish: N g" summary
// line added to RecipeBuilderSheet (Phase 3.6): each component row defaults
// its unit from the picked food's catalog category (liquid/formula/
// breastmilk -> mL, everything else -> g, see defaultUnitForCategory in
// src/components/RecipeBuilderSheet.tsx), the chip is freely switchable, the
// preview hint sums grams and mL 1:1 into one total, and the chosen
// per-component unit round-trips through recipeComponents[] on save/edit.
// Runs against `npm run preview` (dist/) per playwright.config.ts webServer,
// same pattern as tests/manual-nutrition.spec.ts.
//
// FoodLookupSheet's upsertCatalogFromUsda (src/components/FoodLookupSheet.tsx)
// always stamps a *newly created* catalog row with category: 'other',
// regardless of what a USDA hit actually is -- there is no UI path that
// creates a 'liquid'-category catalog row via search/scan. To exercise the
// liquid-defaults-to-mL branch we pre-seed one catalog row directly in
// IndexedDB with category: 'liquid' and a fdcId that the mocked USDA
// search/food-detail endpoints also return; upsertCatalogFromUsda then finds
// it by fdcId and preserves its category when "picked" through the real
// FoodLookupSheet flow (see upsertCatalogFromUsda: `existing && {...fields}`
// spreads over the existing record, and `fields` never includes `category`).

const BANANA = { fdcId: 5551001, description: 'Test Banana Puree', kcal: 90 };
const MILK = { fdcId: 5551002, description: 'Test Whole Milk', kcal: 60 };
const AVOCADO = { fdcId: 5551003, description: 'Test Avocado Mash', kcal: 160 };
const FOODS = [BANANA, MILK, AVOCADO];

/** The preview server has no real backend behind /api; mock both the search
 *  and per-food detail USDA endpoints deterministically off one fixed list
 *  (same reasoning as tests/manual-nutrition.spec.ts's mockUsdaMiss). */
async function mockUsda(page: Page): Promise<void> {
  await page.route('**/api/usda/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/search')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ foods: FOODS.map((f) => ({ fdcId: f.fdcId, description: f.description })) }),
      });
      return;
    }
    const match = url.pathname.match(/\/food\/(\d+)/);
    const fdcId = match ? Number(match[1]) : undefined;
    const food = FOODS.find((f) => f.fdcId === fdcId);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        fdcId: food?.fdcId ?? fdcId,
        description: food?.description ?? 'Unknown',
        foodNutrients: food ? [{ nutrientId: 1008, value: food.kcal }] : [],
      }),
    });
  });
}

/** Writes a FoodCatalogItem straight into IndexedDB (Dexie's on-disk format
 *  is plain IndexedDB, no Dexie import needed in the browser context) so a
 *  'liquid'-category row can exist without a UI path that creates one -- see
 *  the file header comment. */
async function seedLiquidCatalogItem(page: Page): Promise<void> {
  await page.evaluate((food) => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('babyTracker');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const database = req.result;
      const tx = database.transaction('foodCatalog', 'readwrite');
      const now = new Date().toISOString();
      tx.objectStore('foodCatalog').put({
        id: 'seed-milk-liquid',
        type: 'foodCatalog',
        name: food.description,
        category: 'liquid',
        defaultUnit: 'ml',
        ingredientIds: [],
        fdcId: food.fdcId,
        per100: { kcal: food.kcal },
        nutritionSource: 'usda',
        createdAt: now,
        updatedAt: now,
        deleted: 0,
        enteredBy: 'test',
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  }), MILK);
}

interface CatalogRow {
  id: string;
  name: string;
  fdcId?: number;
  deleted: number;
  recipeComponents?: { catalogId: string; grams: number; unit?: 'g' | 'ml' }[];
}

/** Reads foodCatalog rows straight out of IndexedDB -- same pattern as
 *  tests/manual-nutrition.spec.ts's readFoodCatalog. */
async function readFoodCatalog(page: Page): Promise<CatalogRow[]> {
  return page.evaluate(() => new Promise<CatalogRow[]>((resolve, reject) => {
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
}

/** The sheets stacked in these tests (meal / recipe builder / food-lookup) are
 *  DOM siblings, not nested -- each fixed-position overlay is its own
 *  top-level element appended in mount order, so `.sheet` alone is ambiguous
 *  once more than one is open. Each has a unique <h2> title; scope by that. */
function sheetByTitle(page: Page, title: string | RegExp): Locator {
  return page.locator('.sheet').filter({ has: page.locator('h2', { hasText: title }) });
}

/** Field wraps every input in a `.field` div with a sibling <label>; there's
 *  no htmlFor/id linking for getByLabelText to use, so locate by the field
 *  wrapper's text instead (same helper as tests/manual-nutrition.spec.ts). */
function fieldInput(scope: Locator, labelText: string): Locator {
  return scope.locator('.field').filter({ hasText: labelText }).locator('input, textarea').first();
}

async function openMealSheet(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Meal' }).click();
  const sheet = sheetByTitle(page, 'Add meal');
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Opens RecipeBuilderSheet from MealSheet's "🧪 Build/Edit recipe" chip --
 *  the only entry point into the sheet under test (src/components/sheets/MealSheet.tsx). */
async function openRecipeBuilder(meal: Locator, page: Page): Promise<Locator> {
  await meal.getByRole('button', { name: /(build|edit) recipe/i }).click();
  const sheet = sheetByTitle(page, /(Build|Edit) recipe/);
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Adds an ingredient component by searching the (mocked) USDA catalog via
 *  RecipeBuilderSheet's own "🔍 Search" chip -- addComponent() only ever runs
 *  through this FoodLookupSheet round-trip (see handleSearchResolved). */
async function addComponentViaSearch(recipeSheet: Locator, page: Page, description: string): Promise<void> {
  await recipeSheet.getByRole('button', { name: /search/i }).click();
  const lookup = sheetByTitle(page, 'Find food');
  await expect(lookup).toBeVisible();
  await lookup.getByPlaceholder('e.g. sweet potato, whole milk yogurt').fill(description);
  await lookup.getByRole('button', { name: 'Search', exact: true }).click();
  await lookup.getByRole('button', { name: description, exact: true }).click();
  await expect(lookup).toBeHidden();
}

function recipeRow(recipeSheet: Locator, index: number): Locator {
  return recipeSheet.locator('.recipe-row').nth(index);
}
function gramsChip(row: Locator): Locator {
  return row.getByRole('button', { name: 'g', exact: true });
}
function mlChip(row: Locator): Locator {
  return row.getByRole('button', { name: 'mL', exact: true });
}

test.describe.configure({ mode: 'serial' });

test.describe('recipe builder ingredient units', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await mockUsda(page);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Meal' })).toBeVisible();
    await seedLiquidCatalogItem(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('a non-liquid component defaults its unit chip to "g", and the "mL" chip switches it', async () => {
    const meal = await openMealSheet(page);
    const recipe = await openRecipeBuilder(meal, page);

    await addComponentViaSearch(recipe, page, BANANA.description);
    const row = recipeRow(recipe, 0);
    await expect(gramsChip(row)).toHaveClass(/\bon\b/);
    await expect(mlChip(row)).not.toHaveClass(/\bon\b/);

    await mlChip(row).click();
    await expect(mlChip(row)).toHaveClass(/\bon\b/);
    await expect(gramsChip(row)).not.toHaveClass(/\bon\b/);

    await recipe.getByRole('button', { name: 'Cancel' }).click();
    await expect(recipe).toBeHidden();
    await meal.getByRole('button', { name: 'Cancel' }).click();
    await expect(meal).toBeHidden();
  });

  test('a liquid-category component defaults its unit chip to "mL"', async () => {
    const meal = await openMealSheet(page);
    const recipe = await openRecipeBuilder(meal, page);

    await addComponentViaSearch(recipe, page, MILK.description);
    const row = recipeRow(recipe, 0);
    await expect(mlChip(row)).toHaveClass(/\bon\b/);
    await expect(gramsChip(row)).not.toHaveClass(/\bon\b/);

    await recipe.getByRole('button', { name: 'Cancel' }).click();
    await meal.getByRole('button', { name: 'Cancel' }).click();
  });

  test('mixed g/mL amounts across rows sum 1:1 into "Total dish: 500 g"', async () => {
    const meal = await openMealSheet(page);
    const recipe = await openRecipeBuilder(meal, page);

    await addComponentViaSearch(recipe, page, BANANA.description);
    await addComponentViaSearch(recipe, page, AVOCADO.description);

    const row0 = recipeRow(recipe, 0);
    const row1 = recipeRow(recipe, 1);
    await row0.locator('input[type="number"]').fill('300');
    await row1.locator('input[type="number"]').fill('200');
    await mlChip(row1).click(); // mix units on purpose -- math treats 1 mL = 1 g

    await expect(recipe.getByText('Total dish: 500 g', { exact: false })).toBeVisible();

    await recipe.getByRole('button', { name: 'Cancel' }).click();
    await meal.getByRole('button', { name: 'Cancel' }).click();
  });

  test('saving persists each component\'s chosen unit, and editing reopens with the same units preselected', async () => {
    const meal = await openMealSheet(page);
    const recipe = await openRecipeBuilder(meal, page);

    await fieldInput(recipe, 'Recipe name').fill('Unit Test Recipe');
    await addComponentViaSearch(recipe, page, BANANA.description);
    await mlChip(recipeRow(recipe, 0)).click(); // override the 'g' default
    await recipeRow(recipe, 0).locator('input[type="number"]').fill('100');

    await addComponentViaSearch(recipe, page, AVOCADO.description);
    await recipeRow(recipe, 1).locator('input[type="number"]').fill('50'); // left at its 'g' default

    await recipe.locator('.btn.save').click();
    await expect(recipe).toBeHidden();

    const catalog = await readFoodCatalog(page);
    const bananaId = catalog.find((r) => r.fdcId === BANANA.fdcId)?.id;
    const avocadoId = catalog.find((r) => r.fdcId === AVOCADO.fdcId)?.id;
    const saved = catalog.find((r) => r.name === 'Unit Test Recipe' && r.deleted === 0);
    expect(saved).toBeTruthy();
    const bananaComp = saved?.recipeComponents?.find((c) => c.catalogId === bananaId);
    const avocadoComp = saved?.recipeComponents?.find((c) => c.catalogId === avocadoId);
    expect(bananaComp).toMatchObject({ grams: 100, unit: 'ml' });
    expect(avocadoComp).toMatchObject({ grams: 50, unit: 'g' });

    // handleRecipeSave() re-fetches the saved dish and pickDish()s it into the
    // meal form, so the same chip now reads "🧪 Edit recipe".
    const editRecipe = await openRecipeBuilder(meal, page);
    await expect(editRecipe.locator('h2')).toHaveText('Edit recipe');
    const editRow0 = recipeRow(editRecipe, 0);
    const editRow1 = recipeRow(editRecipe, 1);
    await expect(mlChip(editRow0)).toHaveClass(/\bon\b/);
    await expect(gramsChip(editRow1)).toHaveClass(/\bon\b/);

    await editRecipe.getByRole('button', { name: 'Cancel' }).click();
    await meal.getByRole('button', { name: 'Cancel' }).click();
  });
});
