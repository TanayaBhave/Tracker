import { test, expect } from 'playwright/test';

// History tab's "+" quick-add (added alongside the existing day-nav arrows):
// lets a parent backfilling old data (e.g. from personal notes) log an entry
// directly onto whichever day History is currently showing, without having
// to go to Home (which always defaults to "now") and manually re-pick the
// date/time on every sheet. See src/App.tsx's `QuickAddGrid`/`addDate` and
// each sheet's `defaultDate` prop (e.g. src/components/sheets/VomitSheet.tsx).

test.describe('History quick-add', () => {
  test('logging via the "+" from a past day prefills that day, not today, and the entry lands on the right day', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'History' }).click();
    // Step back a few days so we're clearly viewing a day other than today.
    for (let i = 0; i < 4; i++) await page.locator('.day-nav-btn').first().click();
    const viewedDate = await page.locator('input[type="date"]').inputValue();

    await page.locator('.fab').click();
    await expect(page.locator('.sheet-header h2')).toContainText('Add to');
    await page.locator('.qbtn.tone-vomit').click();

    const sheet = page.locator('.sheet').last();
    await expect(sheet).toBeVisible();
    const dtInput = sheet.locator('input[type="datetime-local"]').first();
    // Prefilled to the VIEWED day, not today — the whole point of this feature.
    await expect(dtInput).toHaveValue(new RegExp(`^${viewedDate}T`));

    await sheet.locator('.btn.save').click();
    await expect(sheet).toBeHidden();

    // The new entry shows up on the day it was backfilled to...
    await expect(page.locator('.entry .title', { hasText: 'Vomit' })).toBeVisible();

    // ...and does NOT show up on Today's timeline.
    await page.getByRole('button', { name: 'Today' }).click();
    await expect(page.locator('.entry .title', { hasText: 'Vomit' })).toHaveCount(0);
  });

  test('the "+" popup closes without adding anything on Cancel', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'History' }).click();
    await page.locator('.fab').click();
    await expect(page.locator('.sheet-header h2')).toContainText('Add to');

    await page.locator('.sheet-header .btn.ghost', { hasText: 'Cancel' }).click();
    await expect(page.locator('.sheet-header h2', { hasText: 'Add to' })).toBeHidden();
  });

  test('daily (date-only) records also prefill to the viewed day, e.g. Weight', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'History' }).click();
    for (let i = 0; i < 2; i++) await page.locator('.day-nav-btn').first().click();
    const viewedDate = await page.locator('input[type="date"]').inputValue();

    await page.locator('.fab').click();
    await page.locator('.qbtn.tone-weight').click();
    const sheet = page.locator('.sheet').last();
    const dateInput = sheet.locator('input[type="date"]').first();
    await expect(dateInput).toHaveValue(viewedDate);
  });
});
