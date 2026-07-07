import { test, expect, type Page } from 'playwright/test';
import { correctedAgeMonths, postmenstrualAgeWeeks, chronologicalAgeMonths } from '../src/growth/age';
import { zFromValue, valueFromZ, percentileFromZ } from '../src/growth/lms';
import { whoWfaBoysAt } from '../src/growth/whoWfaBoys';
import { fentonBoys } from '../src/growth/fentonBoys';
import { driBracketFor } from '../src/nutrition/dri';

// Pure-function unit tests for the growth math (no browser needed) — run with
// `npx playwright test tests/growth.spec.ts`.

test.describe('correctedAgeMonths / postmenstrualAgeWeeks', () => {
  test('34w0d preemie, exactly 1 year (365 days) after birth', () => {
    // chronological age = 365 days = 11.99 months; 34w0d gestation is 6 weeks
    // (42 days) premature relative to the 280-day (40wk) term standard, so
    // corrected age = (365 - 42) / 30.4375 = 10.6 months. This is the same
    // formula that produces the roadmap's "13mo actual -> ~11.5mo corrected"
    // figure for a ~13-month-old (395.7 chronological days) with the same
    // gestation — verified below.
    const corrected = correctedAgeMonths('2025-07-06', 34, 0, '2026-07-06');
    expect(corrected).toBeGreaterThan(10.5);
    expect(corrected).toBeLessThan(10.7);
  });

  test('roadmap scenario: ~13mo actual, 34w0d gestation -> ~11.5mo corrected', () => {
    // onDate chosen so chronological age is ~13 months (13 * 30.4375 days after dob).
    const dob = '2025-01-01';
    const onDate = new Date(new Date('2025-01-01T00:00:00Z').getTime() + 13 * 30.4375 * 86_400_000)
      .toISOString().slice(0, 10);
    const corrected = correctedAgeMonths(dob, 34, 0, onDate);
    expect(corrected).toBeGreaterThan(11.3);
    expect(corrected).toBeLessThan(11.7);
  });

  test('term baby (40w0d): corrected age equals chronological age', () => {
    const corrected = correctedAgeMonths('2025-01-01', 40, 0, '2025-07-01');
    const chronologicalDays = (new Date('2025-07-01T00:00:00Z').getTime() - new Date('2025-01-01T00:00:00Z').getTime()) / 86_400_000;
    expect(corrected).toBeCloseTo(chronologicalDays / (365.25 / 12), 6);
  });

  test('postmenstrualAgeWeeks at birth equals gestational age at birth', () => {
    const pma = postmenstrualAgeWeeks('2025-07-06', 34, 3, '2025-07-06');
    expect(pma).toBeCloseTo(34 + 3 / 7, 6);
  });

  test('postmenstrualAgeWeeks a plausible value 6 weeks after a 34w0d birth', () => {
    const pma = postmenstrualAgeWeeks('2025-07-06', 34, 0, '2025-08-17'); // +42 days = 6 weeks
    expect(pma).toBeCloseTo(40, 6); // 34 + 6 = 40 weeks PMA
  });
});

test.describe('chronologicalAgeMonths', () => {
  test('dob 2025-06-05 -> 2026-07-05 is about 13.0 months', () => {
    const months = chronologicalAgeMonths('2025-06-05', '2026-07-05');
    expect(months).toBeGreaterThan(12.8);
    expect(months).toBeLessThan(13.2);
  });

  test('matches daysBetween / DAYS_PER_MONTH directly — no preterm adjustment applied', () => {
    const months = chronologicalAgeMonths('2025-01-01', '2025-07-01');
    const days = (new Date('2025-07-01T00:00:00Z').getTime() - new Date('2025-01-01T00:00:00Z').getTime()) / 86_400_000;
    expect(months).toBeCloseTo(days / (365.25 / 12), 6);
  });

  test('for a preterm baby, chronological age is always older than corrected age', () => {
    // Same dob/onDate as correctedAgeMonths' "roadmap scenario" test above
    // (34w0d gestation): corrected age subtracts the prematurity, so
    // chronological must come out higher for any preterm baby.
    const dob = '2025-01-01';
    const onDate = new Date(new Date('2025-01-01T00:00:00Z').getTime() + 13 * 30.4375 * 86_400_000)
      .toISOString().slice(0, 10);
    const chrono = chronologicalAgeMonths(dob, onDate);
    const corrected = correctedAgeMonths(dob, 34, 0, onDate);
    expect(chrono).toBeGreaterThan(corrected);
    expect(chrono).toBeCloseTo(13, 1);
  });

  test('defaults onDate to today when omitted', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(chronologicalAgeMonths('2020-01-01')).toBeCloseTo(chronologicalAgeMonths('2020-01-01', today), 6);
  });
});

test.describe('DRI bracket selection uses chronological age only (not corrected)', () => {
  test('a 13mo-chronological / 34w0d-preterm baby selects the "1-3 years" bracket', () => {
    // Same roadmap scenario used throughout this file: 34w0d gestation, ~13mo
    // chronological -> ~11.5mo corrected. Under the old corrected-age rule this
    // would select "infant7_12" (< 12mo); the nutritionist tracks chronological
    // age, so the DRI bracket must flip to "child1_3" instead.
    const dob = '2025-01-01';
    const onDate = new Date(new Date('2025-01-01T00:00:00Z').getTime() + 13 * 30.4375 * 86_400_000)
      .toISOString().slice(0, 10);

    const chronoMonths = chronologicalAgeMonths(dob, onDate);
    expect(driBracketFor(chronoMonths)).toBe('child1_3');

    // Sanity check that this is a genuine corrected-vs-chronological flip: the
    // corrected age for the same baby/date is still under 12 months.
    const correctedMonths = correctedAgeMonths(dob, 34, 0, onDate);
    expect(correctedMonths).toBeLessThan(12);
    expect(driBracketFor(correctedMonths)).toBe('infant7_12');
  });

  test('a term newborn under 12mo chronological still selects "infant7_12"', () => {
    const months = chronologicalAgeMonths('2025-01-01', '2025-10-01'); // ~9 months
    expect(driBracketFor(months)).toBe('infant7_12');
  });
});

test.describe('LMS z-score math', () => {
  test('z-score round-trip: valueFromZ(zFromValue(v)) ~= v', () => {
    const L = 0.1021, M = 8.6151, S = 0.10882; // WHO boys 8mo row
    for (const v of [6.5, 7.2, 8.6151, 9.4, 11.0]) {
      const z = zFromValue(v, L, M, S);
      const back = valueFromZ(z, L, M, S);
      expect(back).toBeCloseTo(v, 6);
    }
  });

  test('z-score round-trip with L ~ 0 (log-transform special case)', () => {
    const L = 0, M = 10, S = 0.12;
    const z = zFromValue(11.5, L, M, S);
    expect(valueFromZ(z, L, M, S)).toBeCloseTo(11.5, 6);
  });

  test('z = 0 at the median gives the 50th percentile', () => {
    expect(percentileFromZ(0)).toBeCloseTo(50, 6);
  });

  test('percentileFromZ is monotonic and matches standard normal table at z=+-1.96 (~2.5/97.5)', () => {
    expect(percentileFromZ(1.96)).toBeGreaterThan(97);
    expect(percentileFromZ(1.96)).toBeLessThan(98);
    expect(percentileFromZ(-1.96)).toBeGreaterThan(2);
    expect(percentileFromZ(-1.96)).toBeLessThan(3);
  });

  test('valueFromZ at z=0 returns M for any age row', () => {
    const { L, M, S } = whoWfaBoysAt(11.6);
    expect(valueFromZ(0, L, M, S)).toBeCloseTo(M, 9);
  });
});

test.describe('WHO percentile spot-check vs public reference', () => {
  test('8.4 kg at 11.5 months corrected is ~12-13th percentile', () => {
    // Independent cross-check using the CDC's own precomputed percentile columns
    // (same source CSV as whoWfaBoys.ts, columns beyond L/M/S) rather than our
    // LMS code, so this catches bugs in zFromValue/percentileFromZ or in the
    // embedded L/M/S table itself:
    //   month 11: 10th pct = 8.178615 kg, 25th pct = 8.742959 kg -> 8.4kg sits
    //     about 30% of the way from 10th to 25th, i.e. roughly the ~15th pct.
    //   month 12: 10th pct = 8.382077 kg, 25th pct = 8.960956 kg -> 8.4kg sits
    //     just above the 10th pct line, i.e. roughly the ~10-11th pct.
    // Interpolated to 11.5 months this brackets ~12-13th percentile (<1pt
    // tolerance around 12.5), matching an online WHO weight-for-age (boys)
    // calculator for 11.5 months / 8.4 kg.
    const { L, M, S } = whoWfaBoysAt(11.5);
    const z = zFromValue(8.4, L, M, S);
    const pct = percentileFromZ(z);
    expect(pct).toBeGreaterThan(11.5);
    expect(pct).toBeLessThan(13.5);
  });
});

test.describe('Fenton preterm table', () => {
  test('covers the documented 22.5-50 week PMA domain', () => {
    expect(fentonBoys[0].pmaWeeks).toBe(22.5);
    expect(fentonBoys[fentonBoys.length - 1].pmaWeeks).toBe(50);
  });

  test('percentiles are monotonically increasing at every row (p3 < p10 < p50 < p90 < p97)', () => {
    for (const row of fentonBoys) {
      expect(row.p3).toBeLessThan(row.p10);
      expect(row.p10).toBeLessThan(row.p50);
      expect(row.p50).toBeLessThan(row.p90);
      expect(row.p90).toBeLessThan(row.p97);
    }
  });

  test('median weight increases monotonically with PMA (no data-entry transcription errors)', () => {
    for (let i = 1; i < fentonBoys.length; i++) {
      expect(fentonBoys[i].p50).toBeGreaterThan(fentonBoys[i - 1].p50);
    }
  });

  test('term (40 wk PMA) median weight is in a plausible newborn range', () => {
    const term = fentonBoys.find((r) => r.pmaWeeks === 40)!;
    expect(term.p50).toBeGreaterThan(3.0);
    expect(term.p50).toBeLessThan(4.0);
  });
});

// UI acceptance test for the chronological-age tab (Phase 3.5). Follows the
// serial single-page pattern from tests/smoke.spec.ts — everything below
// shares one seeded browser session so profile/weight setup happens once.
// (Scoped to this describe block only — mode 'serial' is set inside it so
// it doesn't affect the pure-function tests above.)
test.describe('GrowthChart chronological-age tab (UI)', () => {
  test.describe.configure({ mode: 'serial' });

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('seed baby profile (34w0d preterm, ~13mo chronological) and log a weight', async () => {
    await page.goto('/');

    // dob = ~13 calendar months before "today" -> chronological age lands
    // around 13mo, same roadmap scenario used throughout this file (~11.5mo
    // corrected at 34w0d gestation).
    const now = new Date();
    const dob = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 13, now.getUTCDate()))
      .toISOString().slice(0, 10);

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.locator('.field', { hasText: 'Date of birth' }).locator('input').fill(dob);
    await page.locator('.field', { hasText: 'Gestation (weeks)' }).locator('input').fill('34');

    await page.getByRole('button', { name: 'Today' }).click();
    await page.getByRole('button', { name: 'Weight' }).click();
    const sheet = page.locator('.sheet');
    await expect(sheet).toBeVisible();
    await sheet.locator('input[type="number"]').fill('9.2');
    await sheet.locator('.btn.save').click();
    await expect(sheet).toBeHidden();
  });

  test('Growth tab defaults to the "WHO (corrected)" view', async () => {
    await page.getByRole('button', { name: 'Insights' }).click();
    await page.getByRole('button', { name: 'Growth' }).click();

    const correctedChip = page.getByRole('button', { name: 'WHO (corrected)' });
    const chronoChip = page.getByRole('button', { name: 'WHO (chronological)' });
    await expect(correctedChip).toBeVisible();
    await expect(chronoChip).toBeVisible();
    await expect(correctedChip).toHaveClass(/\bon\b/);
    await expect(chronoChip).not.toHaveClass(/\bon\b/);
    await expect(page.locator('.entry .title')).toContainText('mo corrected');
  });

  test('clicking "WHO (chronological)" switches the header stat and shows the preterm hint', async () => {
    const chronoChip = page.getByRole('button', { name: 'WHO (chronological)' });
    await chronoChip.click();

    await expect(chronoChip).toHaveClass(/\bon\b/);
    await expect(page.getByRole('button', { name: 'WHO (corrected)' })).not.toHaveClass(/\bon\b/);
    await expect(page.locator('.entry .title')).toContainText('mo chronological');
    await expect(
      page.locator('.hint', { hasText: 'chronological age than against corrected age' }),
    ).toBeVisible();
  });
});
