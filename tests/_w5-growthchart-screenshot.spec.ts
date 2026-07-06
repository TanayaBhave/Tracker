import { test, expect } from 'playwright/test';

// One-off W5 verification spec (not part of the permanent smoke suite) — sets a
// baby profile, logs a weight, opens the Growth chart, and screenshots it to
// confirm the WHO percentile lines + logged-weight dot + header stat render.
// Safe to delete after manual verification.

test('growth chart renders percentile lines, a logged-weight dot, and the header stat', async ({ page }) => {
  await page.goto('/');

  // Baby profile: DOB chosen so "today" lands around ~11.5 months corrected for a 34w0d preemie.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('input[type="date"]').first().fill('2025-05-01');
  const numberInputs = page.locator('input[type="number"]');
  await numberInputs.nth(0).fill('34'); // gestation weeks
  await numberInputs.nth(1).fill('0'); // gestation + days
  await page.getByRole('button', { name: 'Boy' }).click();

  // Log a weight for today.
  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Weight' }).click();
  const sheet = page.locator('.sheet');
  await expect(sheet).toBeVisible();
  await sheet.locator('input[type="number"]').first().fill('8.4');
  await sheet.locator('.btn.save').click();
  await expect(sheet).toBeHidden();

  // Open Insights -> Growth.
  await page.getByRole('button', { name: 'Insights' }).click();
  await page.getByRole('button', { name: 'Growth' }).click();

  // Default view is WHO; header stat + chart should be present.
  await expect(page.locator('.title', { hasText: 'percentile' })).toBeVisible();
  await expect(page.locator('.recharts-responsive-container')).toBeVisible();
  await expect(page.locator('.recharts-line')).toHaveCount(5); // P3/P15/P50/P85/P97
  await expect(page.locator('.recharts-scatter-symbol')).toHaveCount(1); // the one logged weight

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.screenshot({
    path: 'C:/Users/Tanaya/AppData/Local/Temp/claude/c--Sandbox-Tracker/9aaf9bef-8d80-4b4c-b132-e48284ff3eb3/scratchpad/growth-chart-who-scrolled-bottom.png',
  });

  await page.screenshot({
    path: 'C:/Users/Tanaya/AppData/Local/Temp/claude/c--Sandbox-Tracker/9aaf9bef-8d80-4b4c-b132-e48284ff3eb3/scratchpad/growth-chart-who.png',
    fullPage: true,
  });

  // Switch to Fenton view and screenshot that too.
  await page.getByRole('button', { name: 'Fenton (22–50 wk PMA)' }).click();
  await expect(page.locator('.recharts-line')).toHaveCount(5); // P3/P10/P50/P90/P97
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.screenshot({
    path: 'C:/Users/Tanaya/AppData/Local/Temp/claude/c--Sandbox-Tracker/9aaf9bef-8d80-4b4c-b132-e48284ff3eb3/scratchpad/growth-chart-fenton.png',
  });
});
