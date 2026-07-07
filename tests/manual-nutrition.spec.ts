import { test, expect, type Page, type Locator } from 'playwright/test';

// Browser-driven coverage for the "manual nutrition entry from the product
// label" fallback (Phase 3.5, S1): src/components/ManualNutritionSheet.tsx,
// wired into src/components/FoodLookupSheet.tsx two ways -- a primary button
// in the upc-not-found state, and an always-available secondary link below
// the name-search box. Runs against `npm run preview` (dist/) per
// playwright.config.ts webServer, same pattern as tests/smoke.spec.ts.
//
// Reaching the real upc-not-found state means driving the real scan pipeline
// (MealSheet -> BarcodeScanner -> zxing-wasm decode -> FoodLookupSheet with a
// `upc` prop). There's no manual-UPC-entry UI anywhere in the app (confirmed:
// BarcodeScanner is the only path that ever sets a `upc`), so this fakes the
// camera and the *image*, not the decoder:
//   - Chromium's --use-fake-device-for-media-stream lets getUserMedia
//     succeed with a synthetic video stream (real cameras aren't available
//     in CI).
//   - CanvasRenderingContext2D.prototype.getImageData is overridden (via
//     page.addInitScript, before any app code runs) to always return a
//     hand-encoded UPC-A barcode bitmap instead of whatever the fake video
//     frame contains. zxing-wasm then genuinely decodes it -- the real
//     BarcodeScanner/zxing pipeline runs unmodified; only the "camera sees a
//     real barcode" step is faked, which is the only part infeasible in CI.
//   (Network-level interception of the dynamically-imported zxing-wasm/reader
//   chunk was tried first and does not work: Chromium fetches that chunk in
//   a way that bypasses Playwright's page.route entirely -- confirmed via a
//   standalone repro where the request/response are visible on page.on(...)
//   events but no page.route handler, glob or regex, is ever invoked for it.)
test.use({
  permissions: ['camera'],
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
});

// 12-digit UPC-A payload encoded into the fake barcode image (valid check
// digit: see installFakeBarcodeCanvas). zxing-wasm reports UPC-A codes in
// their EAN-13 form (a leading 0 prepended) -- verified against a live decode
// during test development -- so the app actually sees SCANNED_UPC below.
const ENCODED_UPC = '099999999990';
const SCANNED_UPC = `0${ENCODED_UPC}`; // '0099999999990' -- never a real product

/** Runs in the browser (via page.addInitScript, before any app script) and
 *  replaces every canvas's getImageData with a fixed UPC-A barcode bitmap for
 *  `upc`, so BarcodeScanner's real zxing-wasm decode call reports a real,
 *  checksummed barcode regardless of what the fake camera stream actually
 *  shows. Standard L-code/R-code UPC-A module tables; see e.g. GS1 General
 *  Specifications for the encoding. */
function installFakeBarcodeCanvas(upc: string) {
  const L: Record<string, string> = {
    '0': '0001101', '1': '0011001', '2': '0010011', '3': '0111101', '4': '0100011',
    '5': '0110001', '6': '0101111', '7': '0111011', '8': '0110111', '9': '0001011',
  };
  const R: Record<string, string> = Object.fromEntries(
    Object.entries(L).map(([d, bits]) => [d, bits.split('').map((b) => (b === '1' ? '0' : '1')).join('')]),
  );
  const digits = upc.split('');
  const left = digits.slice(0, 6).map((d) => L[d]).join('');
  const right = digits.slice(6, 12).map((d) => R[d]).join('');
  const modules = `101${left}01010${right}101`; // start guard + 6L + middle guard + 6R + end guard = 95 modules

  const moduleWidth = 4;
  const quietModules = 12; // generous quiet zone on each side (spec minimum is 9/7 modules)
  const barcodeWidth = modules.length * moduleWidth;
  const quietWidth = quietModules * moduleWidth;
  const width = quietWidth * 2 + barcodeWidth;
  const height = 160;

  const row = new Uint8ClampedArray(width * 4);
  for (let x = 0; x < width; x++) {
    let black = false;
    if (x >= quietWidth && x < quietWidth + barcodeWidth) {
      const moduleIndex = Math.floor((x - quietWidth) / moduleWidth);
      black = modules[moduleIndex] === '1';
    }
    const v = black ? 0 : 255;
    row[x * 4] = v; row[x * 4 + 1] = v; row[x * 4 + 2] = v; row[x * 4 + 3] = 255;
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) data.set(row, y * width * 4);
  const fakeImageData = new ImageData(data, width, height);

  CanvasRenderingContext2D.prototype.getImageData = function fakeGetImageData() {
    return fakeImageData;
  };
}

// The preview server (npm run preview) has no backend behind /api (the
// server/usda.js proxy target on :8080 isn't running in this test env);
// mocking the endpoint directly makes "no USDA match" deterministic instead
// of relying on however the dead proxy happens to fail.
async function mockUsdaMiss(page: Page): Promise<void> {
  await page.route('**/api/usda/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ foods: [] }),
  }));
}

interface CatalogRow {
  id: string;
  name: string;
  brand?: string;
  upc?: string;
  per100?: Record<string, number>;
  servingGrams?: number;
  nutritionSource?: string;
  ingredientIds: string[];
  deleted: number;
}

/** Reads foodCatalog rows straight out of IndexedDB (Dexie's on-disk format
 *  is plain IndexedDB) -- no Dexie import needed in the browser context. */
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

/** The sheets stacked in these tests (meal / food-lookup / manual-entry) are
 *  DOM siblings, not nested -- each fixed-position overlay is its own
 *  top-level element appended in mount order, so `.sheet` alone is ambiguous
 *  once more than one is open. Each has a unique <h2> title; scope by that. */
function sheetByTitle(page: Page, title: string): Locator {
  return page.locator('.sheet').filter({ has: page.locator('h2', { hasText: title }) });
}

/** Field/ManualNutritionSheet wrap every input in a `.field` div with a
 *  sibling <label>; there's no htmlFor/id linking for getByLabelText to use,
 *  so locate by the field wrapper's text instead. */
function fieldInput(scope: Locator, labelText: string): Locator {
  return scope.locator('.field').filter({ hasText: labelText }).locator('input, textarea').first();
}

async function openMealSheet(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Meal' }).click();
  const sheet = sheetByTitle(page, 'Add meal');
  await expect(sheet).toBeVisible();
  return sheet;
}

test.describe.configure({ mode: 'serial' });

test.describe('manual nutrition entry from the product label', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.addInitScript(installFakeBarcodeCanvas, ENCODED_UPC);
    await mockUsdaMiss(page);
    await page.goto('/');
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('scan miss opens FoodLookupSheet\'s upc-not-found state with the "Enter nutrition from the label" button, which prefills the scanned UPC', async () => {
    const meal = await openMealSheet(page);
    await meal.getByRole('button', { name: 'Scan UPC' }).click();

    // BarcodeScanner requests the fake camera device and decodes our faked
    // barcode canvas for real via zxing-wasm; FoodLookupSheet then tries the
    // (mocked empty) USDA search and lands on 'upc-not-found' -- the real
    // production code path, not a stub of it.
    await expect(page.getByText(`No USDA match for UPC ${SCANNED_UPC}`)).toBeVisible({ timeout: 15_000 });

    const enterFromLabel = page.getByRole('button', { name: 'Enter nutrition from the label' });
    await expect(enterFromLabel).toBeVisible();
    await enterFromLabel.click();

    const sheet = sheetByTitle(page, 'Enter nutrition from label');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(`Scanned UPC ${SCANNED_UPC} will be saved`)).toBeVisible();

    await fieldInput(sheet, 'Product name').fill('Test Cereal A');
    // Every nutrient left blank on this first save -- keeps per100 unset so a
    // second scan of the same UPC still misses lookupByUpc's local fast path
    // (which only short-circuits once a catalog row's per100 is populated),
    // letting the next test re-reach upc-not-found and exercise dedupe.
    await sheet.locator('.btn.save').click();
    await expect(sheet).toBeHidden();

    // onSelect(catalogId) routed through exactly like the USDA path: the meal
    // sheet's Food field autofills from the newly-created catalog item.
    await expect(meal.getByPlaceholder('e.g. Sweet potato puree')).toHaveValue('Test Cereal A');

    const rows = (await readFoodCatalog(page)).filter((r) => r.upc === SCANNED_UPC && r.deleted === 0);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Test Cereal A');
    expect(rows[0].nutritionSource).toBe('manual');
    expect(rows[0].per100).toBeUndefined(); // nothing entered -> no per100 object at all
    expect(rows[0].ingredientIds.length).toBeGreaterThan(0); // linked to an Ingredient, like the USDA path

    await meal.getByRole('button', { name: 'Cancel' }).click();
    await expect(meal).toBeHidden();
  });

  test('re-scanning the same UPC updates the existing catalog row (dedupe by upc) and converts per-serving to per-100g', async () => {
    const meal = await openMealSheet(page);
    await meal.getByRole('button', { name: 'Scan UPC' }).click();
    await expect(page.getByText(`No USDA match for UPC ${SCANNED_UPC}`)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Enter nutrition from the label' }).click();

    const sheet = sheetByTitle(page, 'Enter nutrition from label');
    await expect(sheet).toBeVisible();

    await fieldInput(sheet, 'Product name').fill('Test Cereal A Updated');
    await fieldInput(sheet, 'Brand').fill('Acme');
    // Entry basis defaults to "Per serving": 8g protein in a 40g serving
    // should convert to 20g per 100g (value * 100 / servingGrams).
    await fieldInput(sheet, 'Serving size').fill('40');
    await fieldInput(sheet, 'Protein (g)').fill('8');
    // Fiber deliberately left blank -- sparse entry must omit the key, never store 0.
    await sheet.locator('.btn.save').click();
    await expect(sheet).toBeHidden();

    await expect(meal.getByPlaceholder('e.g. Sweet potato puree')).toHaveValue('Test Cereal A Updated');

    const rows = (await readFoodCatalog(page)).filter((r) => r.upc === SCANNED_UPC && r.deleted === 0);
    expect(rows).toHaveLength(1); // still exactly one row for this UPC -- updated in place, not duplicated
    expect(rows[0].name).toBe('Test Cereal A Updated');
    expect(rows[0].brand).toBe('Acme');
    expect(rows[0].nutritionSource).toBe('manual');
    expect(rows[0].servingGrams).toBe(40);
    expect(rows[0].per100?.protein_g).toBeCloseTo(20, 6); // 8 * 100 / 40
    expect(rows[0].per100 ? 'fiber_g' in rows[0].per100 : true).toBe(false); // blank stays absent, not 0

    await meal.getByRole('button', { name: 'Cancel' }).click();
    await expect(meal).toBeHidden();
  });

  test('the "Can\'t find it? Enter from the label" link is available from a name search without ever scanning, and supports direct per-100g entry', async () => {
    const meal = await openMealSheet(page);
    await meal.getByRole('button', { name: 'Look up' }).click();

    const lookup = sheetByTitle(page, 'Find food');
    await expect(lookup).toBeVisible();

    const cantFindLink = lookup.getByRole('button', { name: "Can't find it? Enter from the label" });
    await expect(cantFindLink).toBeVisible(); // present before any search is attempted -- not gated on a miss

    await lookup.getByPlaceholder('e.g. sweet potato, whole milk yogurt').fill('Mystery Snack');
    await cantFindLink.click();

    const sheet = sheetByTitle(page, 'Enter nutrition from label');
    await expect(sheet).toBeVisible();
    // initialName prefilled from FoodLookupSheet's search query.
    await expect(fieldInput(sheet, 'Product name')).toHaveValue('Mystery Snack');

    await sheet.getByRole('button', { name: 'Per 100 g' }).click();
    await fieldInput(sheet, 'Calories (kcal)').fill('250');
    await fieldInput(sheet, 'Sodium (mg)').fill('300');
    // Serving size left blank on purpose -- optional in per-100g mode.
    await sheet.locator('.btn.save').click();
    await expect(sheet).toBeHidden();

    await expect(meal.getByPlaceholder('e.g. Sweet potato puree')).toHaveValue('Mystery Snack');

    const rows = (await readFoodCatalog(page)).filter((r) => r.name === 'Mystery Snack' && r.deleted === 0);
    expect(rows).toHaveLength(1);
    expect(rows[0].upc).toBeUndefined(); // opened without a scanned upc
    expect(rows[0].servingGrams).toBeUndefined();
    expect(rows[0].per100?.kcal).toBe(250); // per-100g mode: stored as typed, no conversion
    expect(rows[0].per100?.sodium_mg).toBe(300);
    expect(Object.keys(rows[0].per100 ?? {}).sort()).toEqual(['kcal', 'sodium_mg']); // sparse: nothing else present

    await meal.getByRole('button', { name: 'Cancel' }).click();
    await expect(meal).toBeHidden();
  });

  test('requires a product name, and requires a serving size before converting per-serving values', async () => {
    const meal = await openMealSheet(page);
    await meal.getByRole('button', { name: 'Look up' }).click();
    const lookup = sheetByTitle(page, 'Find food');
    await lookup.getByRole('button', { name: "Can't find it? Enter from the label" }).click();

    const sheet = sheetByTitle(page, 'Enter nutrition from label');
    await expect(sheet).toBeVisible();

    // Blank name is rejected; sheet stays open, nothing saved.
    await sheet.locator('.btn.save').click();
    await expect(sheet.locator('.warn-banner')).toHaveText(/Product name is required/);
    await expect(sheet).toBeVisible();

    // Per-serving mode (the default) with a nutrient entered but no serving
    // size to convert by -> also rejected, distinct message.
    await fieldInput(sheet, 'Product name').fill('No Serving Size Snack');
    await fieldInput(sheet, 'Protein (g)').fill('5');
    await sheet.locator('.btn.save').click();
    await expect(sheet.locator('.warn-banner')).toHaveText(/serving size/i);
    await expect(sheet).toBeVisible();

    const beforeSave = await readFoodCatalog(page);
    expect(beforeSave.some((r) => r.name === 'No Serving Size Snack')).toBe(false); // nothing written on validation failure

    await fieldInput(sheet, 'Serving size').fill('50');
    await sheet.locator('.btn.save').click();
    await expect(sheet).toBeHidden();

    const afterSave = (await readFoodCatalog(page)).filter((r) => r.name === 'No Serving Size Snack');
    expect(afterSave).toHaveLength(1);
    expect(afterSave[0].per100?.protein_g).toBeCloseTo(10, 6); // 5 * 100 / 50

    await meal.getByRole('button', { name: 'Cancel' }).click();
    await expect(meal).toBeHidden();
  });
});
