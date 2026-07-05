import { test, expect, type Page } from 'playwright/test';

// Phase-2 acceptance smoke net: app loads, a meal (with two catalog-created
// ingredients) can be added, survives reload (IndexedDB), edited, and deleted.
// Runs against `npm run preview` (dist/) per playwright.config.ts webServer.

test.describe.configure({ mode: 'serial' });

test.describe('meal lifecycle', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('app loads: nav and quick-add grid are visible', async () => {
    await page.goto('/');

    await expect(page.locator('nav.nav')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Today' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'History' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Insights' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();

    await expect(page.locator('.quickgrid')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Meal' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Vomit' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nappy' })).toBeVisible();
  });

  test('add a meal with two ingredients created via the picker', async () => {
    await page.getByRole('button', { name: 'Meal' }).click();

    const sheet = page.locator('.sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('h2')).toHaveText('Add meal');

    await sheet.getByPlaceholder('e.g. Sweet potato puree').fill('Sweet potato mash');

    const ingredientInput = sheet.getByPlaceholder('Add ingredient…');

    await ingredientInput.fill('sweet potato');
    await sheet.getByRole('button', { name: 'Add "sweet potato"' }).click();
    // IngredientPicker resolves the create+select asynchronously (Dexie write, then
    // setText('')); wait for the chip before typing the next ingredient, otherwise
    // that later setText('') can clobber text typed in the meantime.
    await expect(sheet.getByRole('button', { name: 'sweet potato ✕' })).toBeVisible();

    await ingredientInput.fill('olive oil');
    await sheet.getByRole('button', { name: 'Add "olive oil"' }).click();
    await expect(sheet.getByRole('button', { name: 'olive oil ✕' })).toBeVisible();

    await sheet.locator('.btn.save').click();
    await expect(sheet).toBeHidden();

    await expect(page.locator('.entry', { hasText: 'Sweet potato mash' })).toBeVisible();
  });

  test('reload keeps the entry (IndexedDB persistence)', async () => {
    await page.reload();
    await expect(page.locator('.entry', { hasText: 'Sweet potato mash' })).toBeVisible();
  });

  test('tapping the entry opens a prefilled edit sheet; rename and save', async () => {
    await page.locator('.entry', { hasText: 'Sweet potato mash' }).click();

    const sheet = page.locator('.sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('h2')).toHaveText('Edit meal');

    await expect(sheet.getByPlaceholder('e.g. Sweet potato puree')).toHaveValue('Sweet potato mash');
    await expect(sheet.getByRole('button', { name: 'sweet potato ✕' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'olive oil ✕' })).toBeVisible();

    await sheet.getByPlaceholder('e.g. Sweet potato puree').fill('Avocado mash');
    await sheet.locator('.btn.save').click();
    await expect(sheet).toBeHidden();

    await expect(page.locator('.entry', { hasText: 'Avocado mash' })).toBeVisible();
    await expect(page.locator('.entry', { hasText: 'Sweet potato mash' })).toHaveCount(0);
  });

  test('tapping the entry again and deleting removes it from the timeline', async () => {
    page.once('dialog', (dialog) => void dialog.accept());

    await page.locator('.entry', { hasText: 'Avocado mash' }).click();

    const sheet = page.locator('.sheet');
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Delete' }).click();

    await expect(sheet).toBeHidden();
    await expect(page.locator('.entry', { hasText: 'Avocado mash' })).toHaveCount(0);
  });
});
