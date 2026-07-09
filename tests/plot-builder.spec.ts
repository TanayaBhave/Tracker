import { test, expect } from 'playwright/test';
import {
  inDateRange, dateOnlyToLocalNoon, isProblemStoolConsistency,
  mealLabels, mealsToExposures, factorEventsToDurationIntervals, bucketCounts,
} from '../src/insights/adapters';

// Pure-function unit tests for the Plot Builder's Dexie-record -> engine.ts
// adapters (no browser/Dexie needed) — run with
// `npx playwright test tests/plot-builder.spec.ts`. src/components/PlotBuilder.tsx
// itself has no in-app entry point yet (a later integration step wires it
// into ChartsScreen.tsx), so per the pattern in tests/blend.spec.ts, this file
// covers the pure transforms PlotBuilder relies on directly, rather than
// forcing a browser-driven UI test for a component with nothing to click yet.

test.describe('inDateRange', () => {
  test('includes timestamps on the start and end day boundaries', () => {
    expect(inDateRange('2026-07-01T00:00:00', '2026-07-01', '2026-07-03')).toBe(true);
    expect(inDateRange('2026-07-03T23:59:59', '2026-07-01', '2026-07-03')).toBe(true);
  });

  test('excludes timestamps just outside the range', () => {
    expect(inDateRange('2026-06-30T23:59:59', '2026-07-01', '2026-07-03')).toBe(false);
    expect(inDateRange('2026-07-04T00:00:01', '2026-07-01', '2026-07-03')).toBe(false);
  });

  test('a single-day range includes the whole day', () => {
    expect(inDateRange('2026-07-01T12:00:00', '2026-07-01', '2026-07-01')).toBe(true);
  });
});

test.describe('dateOnlyToLocalNoon', () => {
  test('anchors a YYYY-MM-DD date at local noon', () => {
    expect(dateOnlyToLocalNoon('2026-07-01')).toBe('2026-07-01T12:00:00');
  });

  test('round-trips through inDateRange for the same calendar day', () => {
    const noon = dateOnlyToLocalNoon('2026-07-02');
    expect(inDateRange(noon, '2026-07-02', '2026-07-02')).toBe(true);
    expect(inDateRange(noon, '2026-07-01', '2026-07-01')).toBe(false);
  });
});

test.describe('isProblemStoolConsistency', () => {
  test('flags hard/loose/watery as problem directions', () => {
    expect(isProblemStoolConsistency('hard')).toBe(true);
    expect(isProblemStoolConsistency('loose')).toBe(true);
    expect(isProblemStoolConsistency('watery')).toBe(true);
  });

  test('does not flag formed/soft (the "unremarkable" middle of the scale)', () => {
    expect(isProblemStoolConsistency('formed')).toBe(false);
    expect(isProblemStoolConsistency('soft')).toBe(false);
  });
});

test.describe('mealLabels', () => {
  const meal = {
    timestamp: '2026-07-01T08:00:00Z',
    texture: 'lumpy',
    foodItems: [
      { ingredientIds: ['sweet-potato'], catalogId: 'dish-a' },
      { ingredientIds: [], catalogId: 'dish-b' }, // relies entirely on the catalog union below
    ],
  };
  const catalogIngredientIds = {
    'dish-a': ['sweet-potato', 'cinnamon'], // overlaps with the item's own id -> deduped
    'dish-b': ['rice'],
  };

  test('category "ingredients" unions food-item ids with their catalog item\'s ids, deduped', () => {
    const labels = mealLabels(meal, catalogIngredientIds, 'ingredients');
    expect(labels.sort()).toEqual(['cinnamon', 'rice', 'sweet-potato']);
  });

  test('category "textures" returns just the texture', () => {
    expect(mealLabels(meal, catalogIngredientIds, 'textures')).toEqual(['lumpy']);
  });

  test('category "both" includes ingredients and texture together', () => {
    const labels = mealLabels(meal, catalogIngredientIds, 'both');
    expect(labels.sort()).toEqual(['cinnamon', 'lumpy', 'rice', 'sweet-potato']);
  });

  test('a meal with no texture and no ingredients yields an empty label set', () => {
    const bare = { timestamp: '2026-07-01T08:00:00Z', foodItems: [{ ingredientIds: [] }] };
    expect(mealLabels(bare, {}, 'both')).toEqual([]);
  });

  test('a foodItem catalogId not present in the map contributes nothing extra (no throw)', () => {
    const meal2 = { timestamp: '2026-07-01T08:00:00Z', foodItems: [{ ingredientIds: ['a'], catalogId: 'missing' }] };
    expect(mealLabels(meal2, {}, 'ingredients')).toEqual(['a']);
  });
});

test.describe('mealsToExposures', () => {
  test('maps each meal to a LabelledExposure carrying its timestamp and labels', () => {
    const meals = [
      { timestamp: '2026-07-01T08:00:00Z', texture: 'mashed', foodItems: [{ ingredientIds: ['banana'] }] },
      { timestamp: '2026-07-02T08:00:00Z', foodItems: [{ ingredientIds: ['banana'] }] },
    ];
    const exposures = mealsToExposures(meals, {}, 'ingredients');
    expect(exposures).toEqual([
      { timestamp: '2026-07-01T08:00:00Z', labels: ['banana'] },
      { timestamp: '2026-07-02T08:00:00Z', labels: ['banana'] },
    ]);
  });

  test('empty meal list yields an empty exposure list', () => {
    expect(mealsToExposures([], {}, 'both')).toEqual([]);
  });
});

test.describe('factorEventsToDurationIntervals', () => {
  test('keeps only non-deleted, closed (start+end) events', () => {
    const events = [
      { deleted: 0, startTime: '2026-07-01T08:00:00Z', endTime: '2026-07-01T09:00:00Z' }, // kept
      { deleted: 1, startTime: '2026-07-01T10:00:00Z', endTime: '2026-07-01T11:00:00Z' }, // deleted -> dropped
      { deleted: 0, startTime: '2026-07-01T12:00:00Z' }, // open-ended -> dropped
      { deleted: 0, endTime: '2026-07-01T13:00:00Z' }, // no start -> dropped
    ];
    expect(factorEventsToDurationIntervals(events)).toEqual([
      { start: '2026-07-01T08:00:00Z', end: '2026-07-01T09:00:00Z' },
    ]);
  });

  test('empty input yields an empty interval list', () => {
    expect(factorEventsToDurationIntervals([])).toEqual([]);
  });
});

test.describe('bucketCounts', () => {
  test('day bucketing groups by local calendar day', () => {
    const result = bucketCounts([
      '2026-07-01T08:00:00',
      '2026-07-01T20:00:00',
      '2026-07-02T00:30:00',
    ], 'day');
    expect(result).toEqual([
      { bucket: '2026-07-01', count: 2 },
      { bucket: '2026-07-02', count: 1 },
    ]);
  });

  test('week bucketing anchors on the Monday of each timestamp\'s week', () => {
    // 2026-07-01 is a Wednesday; its week's Monday is 2026-06-29.
    // 2026-07-06 is a Monday, so it anchors to itself.
    const result = bucketCounts([
      '2026-07-01T08:00:00',
      '2026-07-02T08:00:00',
      '2026-07-06T08:00:00',
    ], 'week');
    expect(result).toEqual([
      { bucket: '2026-06-29', count: 2 },
      { bucket: '2026-07-06', count: 1 },
    ]);
  });

  test('sorted ascending by bucket key, and empty input yields an empty list', () => {
    const result = bucketCounts(['2026-07-05T00:00:00', '2026-07-01T00:00:00'], 'day');
    expect(result.map((b) => b.bucket)).toEqual(['2026-07-01', '2026-07-05']);
    expect(bucketCounts([], 'day')).toEqual([]);
  });
});
