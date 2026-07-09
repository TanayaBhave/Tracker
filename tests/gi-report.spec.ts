import { test, expect } from 'playwright/test';
import {
  dateKey, inRange, buildLabelledExposures, sortRatesDesc, tallyDefined,
  isRedFlagVomit, vomitSummary, didMealCauseVomit, burpVomitStats,
} from '../src/components/GIReportSheet';

// Pure-function unit tests for the GI-ready report's computation helpers (no
// browser needed) — run with `npx playwright test tests/gi-report.spec.ts`.
// GIReportSheet.tsx has no in-app entry point yet (a later integration step
// wires a Settings button to it), so this exercises the exported pure
// functions directly rather than navigating to it, same style as
// tests/blend.spec.ts / tests/insights-engine.spec.ts.

test.describe('dateKey / inRange', () => {
  test('dateKey takes the YYYY-MM-DD prefix of an ISO timestamp or a plain date', () => {
    expect(dateKey('2026-07-09T14:30:00.000Z')).toBe('2026-07-09');
    expect(dateKey('2026-07-09')).toBe('2026-07-09');
  });

  test('inRange is inclusive on both boundary dates', () => {
    expect(inRange('2026-07-01T00:00:00', '2026-07-01', '2026-07-31')).toBe(true);
    expect(inRange('2026-07-31T23:59:59', '2026-07-01', '2026-07-31')).toBe(true);
  });

  test('inRange excludes dates outside the range', () => {
    expect(inRange('2026-06-30T23:59:59', '2026-07-01', '2026-07-31')).toBe(false);
    expect(inRange('2026-08-01T00:00:00', '2026-07-01', '2026-07-31')).toBe(false);
  });
});

test.describe('buildLabelledExposures', () => {
  test('resolves ingredient ids to names, dedupes, and appends a prefixed texture label', () => {
    const names = new Map([['ing-1', 'Sweet potato'], ['ing-2', 'Rice cereal']]);
    const [exposure] = buildLabelledExposures(
      [{
        timestamp: '2026-07-01T08:00:00',
        foodItems: [{ ingredientIds: ['ing-1', 'ing-2'] }, { ingredientIds: ['ing-1'] }],
        texture: 'lumpy',
      }],
      names,
    );
    expect(exposure.timestamp).toBe('2026-07-01T08:00:00');
    expect(exposure.labels).toEqual(['Sweet potato', 'Rice cereal', 'Texture: lumpy']);
  });

  test('an unresolved ingredient id falls back to the raw id', () => {
    const [exposure] = buildLabelledExposures(
      [{ timestamp: '2026-07-01T08:00:00', foodItems: [{ ingredientIds: ['missing-id'] }] }],
      new Map(),
    );
    expect(exposure.labels).toEqual(['missing-id']);
  });

  test('a meal with no ingredients and no texture yields an empty label list, not an error', () => {
    const [exposure] = buildLabelledExposures(
      [{ timestamp: '2026-07-01T08:00:00', foodItems: [] }],
      new Map(),
    );
    expect(exposure.labels).toEqual([]);
  });
});

test.describe('sortRatesDesc', () => {
  test('sorts by rate descending, independent of the engine\'s label-ascending order', () => {
    const sorted = sortRatesDesc([
      { label: 'a', exposures: 2, outcomes: 1, rate: 0.5 },
      { label: 'b', exposures: 2, outcomes: 2, rate: 1 },
      { label: 'c', exposures: 4, outcomes: 0, rate: 0 },
    ]);
    expect(sorted.map((r) => r.label)).toEqual(['b', 'a', 'c']);
  });
});

test.describe('tallyDefined', () => {
  test('counts each defined value, skipping undefined entries entirely (not as a 0 count)', () => {
    const result = tallyDefined(['more', 'less', 'more', undefined, 'more']);
    expect(result).toEqual({ more: 3, less: 1 });
    expect(Object.prototype.hasOwnProperty.call(result, 'regular')).toBe(false);
  });

  test('empty input yields an empty object', () => {
    expect(tallyDefined([])).toEqual({});
  });
});

test.describe('isRedFlagVomit', () => {
  test('bile-green appearance is a red flag', () => {
    expect(isRedFlagVomit({ appearance: 'bile-green' })).toBe(true);
  });

  test('bloody-streak appearance is a red flag', () => {
    expect(isRedFlagVomit({ appearance: 'bloody-streak' })).toBe(true);
  });

  test('projectile forcefulness is a red flag regardless of appearance', () => {
    expect(isRedFlagVomit({ appearance: 'milky-undigested', forcefulness: 'projectile' })).toBe(true);
  });

  test('an ordinary spit-up is not a red flag', () => {
    expect(isRedFlagVomit({ appearance: 'milky-undigested', forcefulness: 'effortless' })).toBe(false);
  });

  test('no appearance/forcefulness recorded is not a red flag', () => {
    expect(isRedFlagVomit({})).toBe(false);
  });
});

test.describe('vomitSummary', () => {
  test('tallies severity/forcefulness/appearance and counts red flags', () => {
    const summary = vomitSummary([
      { severity: 'large', forcefulness: 'projectile', appearance: 'milky-undigested' },
      { severity: 'spit-up', appearance: 'bile-green' },
      { severity: 'spit-up' },
    ]);
    expect(summary.total).toBe(3);
    expect(summary.bySeverity).toEqual({ large: 1, 'spit-up': 2 });
    expect(summary.byForcefulness).toEqual({ projectile: 1 });
    expect(summary.byAppearance).toEqual({ 'milky-undigested': 1, 'bile-green': 1 });
    expect(summary.redFlagCount).toBe(2); // projectile one + bile-green one
  });

  test('an empty vomit list is safe', () => {
    const summary = vomitSummary([]);
    expect(summary.total).toBe(0);
    expect(summary.redFlagCount).toBe(0);
    expect(summary.bySeverity).toEqual({});
  });
});

test.describe('didMealCauseVomit / burpVomitStats', () => {
  test('a meal tagged reaction:vomited counts even with no linked VomitEvent', () => {
    expect(didMealCauseVomit({ id: 'm1', reaction: 'vomited' }, [])).toBe(true);
  });

  test('a meal linked from a separately-logged VomitEvent counts even if its own reaction is none', () => {
    expect(didMealCauseVomit({ id: 'm1', reaction: 'none' }, [{ linkedMealId: 'm1' }])).toBe(true);
  });

  test('a meal with neither signal does not count', () => {
    expect(didMealCauseVomit({ id: 'm1', reaction: 'fussy' }, [{ linkedMealId: 'm2' }])).toBe(false);
  });

  test('burpVomitStats splits burped (yes/partial) vs not-burped (no) into two groups with independent rates', () => {
    const meals = [
      { id: 'm1', reaction: 'vomited', burped: 'no' },
      { id: 'm2', reaction: 'none', burped: 'no' },
      { id: 'm3', reaction: 'none', burped: 'yes' },
      { id: 'm4', reaction: 'vomited', burped: 'partial' },
    ];
    const stats = burpVomitStats(meals, []);
    expect(stats.notBurped).toEqual({ count: 2, vomited: 1, rate: 0.5 });
    expect(stats.burped).toEqual({ count: 2, vomited: 1, rate: 0.5 });
  });

  test('meals with burped left unset fall into neither group', () => {
    const meals = [
      { id: 'm1', reaction: 'vomited' }, // burped unset
    ];
    const stats = burpVomitStats(meals, []);
    expect(stats.burped.count).toBe(0);
    expect(stats.notBurped.count).toBe(0);
  });

  test('an empty meal list yields 0/0/0 for both groups, no NaN', () => {
    const stats = burpVomitStats([], []);
    expect(stats.burped).toEqual({ count: 0, vomited: 0, rate: 0 });
    expect(stats.notBurped).toEqual({ count: 0, vomited: 0, rate: 0 });
  });
});
