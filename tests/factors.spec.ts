import { test, expect, type Page, type Locator } from 'playwright/test';

// Browser-driven coverage for the "Manage Factors" feature (CLAUDE.md key
// screen #5, last remaining M1 item): src/components/FactorManagerSheet.tsx
// (create/edit/archive custom labels) and src/components/sheets/FactorEventSheet.tsx
// (log/edit one occurrence), wired into Home's quick-add grid (the "Factor"
// tile) and src/components/Timeline.tsx. Runs against `npm run preview`
// (dist/) per playwright.config.ts webServer. Follows the serial
// single-shared-page style of tests/smoke.spec.ts, since this flow is a
// single continuous story (create -> log -> edit -> archive) rather than
// independent seeded cases.

/** FactorManagerSheet and FactorEventSheet are DOM sibling overlays, same
 *  pattern as other custom (non-<Sheet>) or nested-<Sheet> screens -- scope
 *  by <h2> title so `.entry` rows in one sheet never collide with rows
 *  elsewhere (e.g. Home's Timeline underneath). See sheetByTitle in
 *  tests/catalog-manager.spec.ts / tests/manual-nutrition.spec.ts. */
function sheetByTitle(page: Page, title: string): Locator {
  return page.locator('.sheet').filter({ has: page.locator('h2', { hasText: title }) });
}

test.describe.configure({ mode: 'serial' });

test.describe('Manage Factors', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('Home has a Factor quick-add tile that opens the manager', async () => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Factor' })).toBeVisible();

    await page.getByRole('button', { name: 'Factor' }).click();
    const manage = sheetByTitle(page, 'Manage factors');
    await expect(manage).toBeVisible();
    await expect(manage.locator('.empty')).toHaveText('No factors yet. Add one above.');
  });

  test('create a new instant-kind Factor', async () => {
    const manage = sheetByTitle(page, 'Manage factors');
    await manage.locator('input[placeholder="e.g. Car ride"]').fill('Car ride');
    // 'Instant' is the default-selected kind chip -- no need to click it.
    await manage.getByRole('button', { name: '+ Add factor' }).click();

    const row = manage.locator('.entry').filter({ hasText: 'Car ride' });
    await expect(row).toBeVisible();
    await expect(row.locator('.meta')).toHaveText('Instant');
    await expect(row.getByRole('button', { name: 'Log' })).toBeVisible();
  });

  test('log an event for the Factor via the row\'s Log button', async () => {
    const manage = sheetByTitle(page, 'Manage factors');
    const row = manage.locator('.entry').filter({ hasText: 'Car ride' });
    await row.getByRole('button', { name: 'Log' }).click();

    const logSheet = sheetByTitle(page, 'Log Car ride');
    await expect(logSheet).toBeVisible();
    await logSheet.locator('textarea').fill('Long drive');
    await logSheet.locator('.btn.save').click();
    await expect(logSheet).toBeHidden();

    // Back at the (still open) manager sheet -- close it to see the Timeline.
    await manage.getByRole('button', { name: 'Close' }).click();
    await expect(manage).toBeHidden();
  });

  test('the logged event appears in Home\'s Timeline with the Factor\'s name', async () => {
    const entry = page.locator('.entry', { hasText: 'Car ride' });
    await expect(entry).toBeVisible();
    await expect(entry.locator('.dot.tone-factorEvent')).toBeVisible();
    await expect(entry.locator('.meta')).toHaveText('Long drive');
  });

  test('tapping the entry opens a prefilled edit sheet; change notes and save', async () => {
    await page.locator('.entry', { hasText: 'Car ride' }).click();

    const editSheet = sheetByTitle(page, 'Edit Car ride');
    await expect(editSheet).toBeVisible();
    await expect(editSheet.locator('textarea')).toHaveValue('Long drive');

    await editSheet.locator('textarea').fill("Long drive to grandma's");
    await editSheet.locator('.btn.save').click();
    await expect(editSheet).toBeHidden();

    const entry = page.locator('.entry', { hasText: 'Car ride' });
    await expect(entry.locator('.meta')).toHaveText("Long drive to grandma's");
  });

  test('reload keeps the Factor and its event (IndexedDB persistence)', async () => {
    await page.reload();
    const entry = page.locator('.entry', { hasText: 'Car ride' });
    await expect(entry).toBeVisible();
    await expect(entry.locator('.meta')).toHaveText("Long drive to grandma's");
  });

  test('archiving the Factor hides it from the active list but the past event still renders', async () => {
    await page.getByRole('button', { name: 'Factor' }).click();
    const manage = sheetByTitle(page, 'Manage factors');
    await expect(manage).toBeVisible();

    const row = manage.locator('.entry').filter({ hasText: 'Car ride' });
    await row.getByRole('button', { name: 'Archive' }).click();

    // Gone from the active section (archived rows aren't rendered until the
    // "Archived" toggle is expanded).
    await expect(manage.locator('.entry').filter({ hasText: 'Car ride' })).toHaveCount(0);

    await manage.getByRole('button', { name: 'Archived (1)' }).click();
    const archivedRow = manage.locator('.entry').filter({ hasText: 'Car ride' });
    await expect(archivedRow).toBeVisible();
    await expect(archivedRow.getByRole('button', { name: 'Unarchive' })).toBeVisible();

    await manage.getByRole('button', { name: 'Close' }).click();
    await expect(manage).toBeHidden();

    // History isn't erased: the previously-logged event still renders in
    // Timeline with the (now-archived) Factor's name and notes.
    const entry = page.locator('.entry', { hasText: 'Car ride' });
    await expect(entry).toBeVisible();
    await expect(entry.locator('.meta')).toHaveText("Long drive to grandma's");
  });
});
