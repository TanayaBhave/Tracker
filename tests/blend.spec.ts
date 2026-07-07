import { test, expect } from 'playwright/test';
import { blendPer100, unionIngredientIds } from '../src/nutrition/blend';

// Pure-function unit tests for the recipe/composite-dish blend math (no
// browser needed) — run with `npx playwright test tests/blend.spec.ts`.

test.describe('blendPer100', () => {
  test('simple two-component weighted blend (hand-computed)', () => {
    // 40g of A (per100 kcal 200, protein 4g) + 60g of B (per100 kcal 50, protein 1g).
    // Weighted numerators: kcal = 200*40/100 + 50*60/100 = 80 + 30 = 110; over
    // totalGrams 100 * 100 => 110 kcal per 100g. protein = 4*40/100 + 1*60/100
    // = 1.6 + 0.6 = 2.2; over 100 * 100 => 2.2 g per 100g.
    const result = blendPer100([
      { per100: { kcal: 200, protein_g: 4 }, grams: 40 },
      { per100: { kcal: 50, protein_g: 1 }, grams: 60 },
    ]);
    expect(result.totalGrams).toBe(100);
    expect(result.knownCount).toBe(2);
    expect(result.totalCount).toBe(2);
    expect(result.per100.kcal).toBeCloseTo(110, 6);
    expect(result.per100.protein_g).toBeCloseTo(2.2, 6);
  });

  test('component without per100 dilutes the blend (its grams still count toward the denominator)', () => {
    // 50g of A (per100 kcal 200) + 50g of B with no nutrition data at all.
    // Numerator only gets A's contribution: 200*50/100 = 100; but totalGrams
    // is still 100 (both components' grams), so blended kcal = 100/100*100 = 100
    // (half of what it would be if the unknown component were excluded, i.e. a
    // deliberate honest undercount, not a silent drop).
    const result = blendPer100([
      { per100: { kcal: 200 }, grams: 50 },
      { grams: 50 }, // no per100 at all
    ]);
    expect(result.totalGrams).toBe(100);
    expect(result.knownCount).toBe(1);
    expect(result.totalCount).toBe(2);
    expect(result.per100.kcal).toBeCloseTo(100, 6);
  });

  test('a component missing just one nutrient key dilutes only that key', () => {
    const result = blendPer100([
      { per100: { kcal: 100, iron_mg: 2 }, grams: 100 },
      { per100: { kcal: 100 }, grams: 100 }, // has kcal, missing iron_mg
    ]);
    // kcal: both contribute fully -> 100.
    expect(result.per100.kcal).toBeCloseTo(100, 6);
    // iron: only the first component contributes -> (2*100/100 + 0*100/100) / 200 * 100 = 1.
    expect(result.per100.iron_mg).toBeCloseTo(1, 6);
    expect(result.knownCount).toBe(2); // both components DO have a per100 object
  });

  test('empty component list is safe (no NaN/Infinity)', () => {
    const result = blendPer100([]);
    expect(result.totalGrams).toBe(0);
    expect(result.knownCount).toBe(0);
    expect(result.totalCount).toBe(0);
    expect(result.per100).toEqual({});
  });

  test('all-zero-grams input is safe (no NaN/Infinity, never divides by zero)', () => {
    const result = blendPer100([
      { per100: { kcal: 200 }, grams: 0 },
      { per100: { kcal: 50 }, grams: 0 },
    ]);
    expect(result.totalGrams).toBe(0);
    expect(result.totalCount).toBe(2);
    expect(result.knownCount).toBe(2);
    expect(result.per100).toEqual({});
    for (const v of Object.values(result.per100)) {
      expect(Number.isFinite(v as number)).toBe(true);
    }
  });

  test('negative grams are treated as zero, not subtracted from the denominator', () => {
    const result = blendPer100([
      { per100: { kcal: 200 }, grams: 100 },
      { per100: { kcal: 9999 }, grams: -50 },
    ]);
    expect(result.totalGrams).toBe(100);
    expect(result.per100.kcal).toBeCloseTo(200, 6);
  });

  // Phase 3.6: sugar_g/addedSugar_g were added to NutrientProfile and
  // NUTRIENT_KEYS (now centralized in src/db.ts and imported here, rather than
  // duplicated) — this is a regression guard that the blend loop actually
  // picks up both new keys like any other nutrient, weighted the same way.
  test('sugar_g and addedSugar_g blend the same as any other nutrient key', () => {
    const result = blendPer100([
      { per100: { sugar_g: 20, addedSugar_g: 10 }, grams: 50 },
      { per100: { sugar_g: 4, addedSugar_g: 0 }, grams: 50 },
    ]);
    // sugar_g: (20*50/100 + 4*50/100) / 100 * 100 = 10 + 2 = 12.
    expect(result.per100.sugar_g).toBeCloseTo(12, 6);
    // addedSugar_g: (10*50/100 + 0*50/100) / 100 * 100 = 5 + 0 = 5.
    expect(result.per100.addedSugar_g).toBeCloseTo(5, 6);
  });

  test('a component missing sugar keys dilutes them toward zero, like any other nutrient', () => {
    const result = blendPer100([
      { per100: { sugar_g: 30 }, grams: 100 },
      { per100: { kcal: 50 }, grams: 100 }, // no sugar_g at all
    ]);
    // (30*100/100 + 0*100/100) / 200 * 100 = 15.
    expect(result.per100.sugar_g).toBeCloseTo(15, 6);
    expect(result.per100.addedSugar_g).toBeCloseTo(0, 6); // neither component has it -> 0, not undefined
  });
});

test.describe('unionIngredientIds', () => {
  test('dedupes across components, preserving first-occurrence order', () => {
    const union = unionIngredientIds([
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd', 'a'],
    ]);
    expect(union).toEqual(['a', 'b', 'c', 'd']);
  });

  test('empty input yields an empty union', () => {
    expect(unionIngredientIds([])).toEqual([]);
    expect(unionIngredientIds([[], []])).toEqual([]);
  });
});
