import { test, expect } from 'playwright/test';
import { doseScaleFactor } from '../src/nutrition/intake';
import { normalizeDsldLabel, upcFromUpcSku } from '../src/nutrition/dsldClient';
import { cleanProductName } from '../src/nutrition/productName';

// Pure-function unit tests for the med/supplement catalog feature (no browser
// needed) — run with `npx playwright test tests/medcatalog.spec.ts`.

// ---- doseScaleFactor (see src/nutrition/intake.ts) ----

test.describe('doseScaleFactor', () => {
  test('scales by ratio when amounts present and units match', () => {
    expect(doseScaleFactor(2.5, 'ml', 5, 'ml')).toBeCloseTo(0.5, 9);
    expect(doseScaleFactor(10, 'drops', 5, 'drops')).toBeCloseTo(2, 9);
  });

  test('unit comparison is case-insensitive and trimmed', () => {
    expect(doseScaleFactor(7.5, ' ML ', 5, 'ml')).toBeCloseTo(1.5, 9);
  });

  test('unit mismatch counts as exactly one dose', () => {
    expect(doseScaleFactor(2, 'drops', 5, 'ml')).toBe(1);
  });

  test('missing logged amount counts as one dose', () => {
    expect(doseScaleFactor(undefined, 'ml', 5, 'ml')).toBe(1);
  });

  test('missing catalog default counts as one dose', () => {
    expect(doseScaleFactor(5, 'ml', undefined, 'ml')).toBe(1);
    expect(doseScaleFactor(5, 'ml', 5, undefined)).toBe(1);
  });

  test('nonsensical defaults (zero/negative) count as one dose, never divide by zero', () => {
    expect(doseScaleFactor(5, 'ml', 0, 'ml')).toBe(1);
    expect(doseScaleFactor(-2, 'ml', 5, 'ml')).toBe(1);
  });
});

// ---- normalizeDsldLabel (see src/nutrition/dsldClient.ts) ----

// Captured verbatim from a live DSLD API response during implementation:
// GET https://api.ods.od.nih.gov/dsld/v9/label/30848 (trimmed to the fields
// the normalizer reads). Vitamin D3 listed in IU only.
const DSLD_LABEL_VITD = {
  id: 30848,
  fullName: '100% Natural Vitamin D3',
  brandName: 'Whole Body Research',
  upcSku: '',
  ingredientRows: [
    {
      order: 1,
      ingredientId: 280374,
      name: 'Vitamin D3',
      category: 'vitamin',
      ingredientGroup: 'Vitamin D',
      uniiCode: '1C6V77QF41',
      quantity: [
        {
          servingSizeOrder: 1,
          servingSizeQuantity: 1,
          operator: '=',
          quantity: 2000,
          unit: 'IU',
          servingSizeUnit: 'Softgel(s)',
        },
      ],
    },
  ],
};

// Captured verbatim from GET https://api.ods.od.nih.gov/dsld/v9/label/259264
// (trimmed): a multi-ingredient supplement whose upcSku is an Amazon SKU, not
// a barcode. Niacin/B6/proprietary blend have no NutrientProfile mapping and
// must be skipped; folate/B12/zinc must map.
const DSLD_LABEL_MULTI = {
  id: 259264,
  fullName: 'SpermTonic 1000 mg',
  brandName: 'HerbTonics',
  upcSku: 'X002FAT3RF',
  servingSizes: [
    { order: 1, minQuantity: 2, maxQuantity: 2, minDailyServings: 1, maxDailyServings: 1, unit: 'Vegetarian Capsule(s)' },
  ],
  ingredientRows: [
    {
      order: 1, ingredientId: 280746, name: 'Niacin', category: 'vitamin',
      quantity: [{ servingSizeOrder: 1, servingSizeQuantity: 2, operator: '=', quantity: 16, unit: 'mg', servingSizeUnit: 'Vegetarian Capsule(s)' }],
    },
    {
      order: 2, ingredientId: 296067, name: 'Vitamin B6', category: 'vitamin',
      quantity: [{ servingSizeOrder: 1, servingSizeQuantity: 2, operator: '=', quantity: 5, unit: 'mg', servingSizeUnit: 'Vegetarian Capsule(s)' }],
    },
    {
      order: 3, ingredientId: 296368, name: 'Folate', category: 'vitamin',
      quantity: [{ servingSizeOrder: 1, servingSizeQuantity: 2, operator: '=', quantity: 400, unit: 'mcg', servingSizeUnit: 'Vegetarian Capsule(s)' }],
    },
    {
      order: 4, ingredientId: 281388, name: 'Vitamin B12', category: 'vitamin',
      quantity: [{ servingSizeOrder: 1, servingSizeQuantity: 2, operator: '=', quantity: 20, unit: 'mcg', servingSizeUnit: 'Vegetarian Capsule(s)' }],
    },
    {
      order: 5, ingredientId: 293070, name: 'Zinc', category: 'mineral',
      quantity: [{ servingSizeOrder: 1, servingSizeQuantity: 2, operator: '=', quantity: 22, unit: 'mg', servingSizeUnit: 'Vegetarian Capsule(s)' }],
    },
    {
      order: 6, ingredientId: 299718, name: 'SpermTonic Blend', category: 'blend',
      quantity: [{ servingSizeOrder: 1, servingSizeQuantity: 2, operator: '=', quantity: 1000, unit: 'mg', servingSizeUnit: 'Vegetarian Capsule(s)' }],
    },
  ],
};

test.describe('normalizeDsldLabel', () => {
  test('vitamin D listed in IU converts to µg (÷40, NIH ODS factor)', () => {
    const s = normalizeDsldLabel(DSLD_LABEL_VITD);
    expect(s.name).toBe('100% Natural Vitamin D3');
    expect(s.brand).toBe('Whole Body Research');
    expect(s.perDose.vitD_ug).toBeCloseTo(50, 9); // 2000 IU / 40
    expect(s.upc).toBeUndefined(); // empty upcSku
  });

  test('maps folate/B12/zinc; skips niacin, B6, and blends rather than guessing', () => {
    const s = normalizeDsldLabel(DSLD_LABEL_MULTI);
    expect(s.perDose.folate_ug).toBe(400);
    expect(s.perDose.vitB12_ug).toBe(20);
    expect(s.perDose.zinc_mg).toBe(22);
    // Unmapped rows must be absent, not zero or misattributed.
    expect(Object.keys(s.perDose).sort()).toEqual(['folate_ug', 'vitB12_ug', 'zinc_mg']);
  });

  test('printed serving becomes the default dose; non-barcode upcSku is dropped', () => {
    const s = normalizeDsldLabel(DSLD_LABEL_MULTI);
    expect(s.defaultDoseAmount).toBe(2);
    expect(s.defaultDoseUnit).toBe('vegetarian capsules'); // "Vegetarian Capsule(s)" cleaned
    expect(s.upc).toBeUndefined(); // "X002FAT3RF" is an Amazon SKU, not a GTIN
  });

  test('vitamin A in IU converts only for a named retinol form (constructed rows)', () => {
    // Constructed (not captured) rows exercising the retinol-only IU rule:
    // 1 IU retinol = 0.3 µg RAE, but beta-carotene differs, so unspecified
    // IU must be skipped.
    const retinol = normalizeDsldLabel({
      ingredientRows: [{
        name: 'Vitamin A (as Retinyl Palmitate)',
        quantity: [{ servingSizeOrder: 1, quantity: 3330, unit: 'IU' }],
      }],
    });
    expect(retinol.perDose.vitA_ug_rae).toBeCloseTo(1000, 0); // 3330 / 3.33

    const unspecified = normalizeDsldLabel({
      ingredientRows: [{
        name: 'Vitamin A',
        quantity: [{ servingSizeOrder: 1, quantity: 3330, unit: 'IU' }],
      }],
    });
    expect(unspecified.perDose.vitA_ug_rae).toBeUndefined();
  });

  test('"(as ...)" parentheticals are stripped before name matching', () => {
    const s = normalizeDsldLabel({
      ingredientRows: [{
        name: 'Vitamin D (as Cholecalciferol)',
        quantity: [{ servingSizeOrder: 1, quantity: 10, unit: 'mcg' }],
      }],
    });
    expect(s.perDose.vitD_ug).toBe(10);
  });
});

test.describe('upcFromUpcSku', () => {
  test('DSLD display-format UPC normalizes to plain digits', () => {
    // Captured from label 246011 (Culturelle Baby Grow + Thrive).
    expect(upcFromUpcSku('0 49100 40053 2')).toBe('049100400532');
  });

  test('non-barcode SKUs and empties return undefined', () => {
    expect(upcFromUpcSku('X002FAT3RF')).toBeUndefined();
    expect(upcFromUpcSku('')).toBeUndefined();
    expect(upcFromUpcSku(undefined)).toBeUndefined();
  });
});

// ---- cleanProductName (see src/nutrition/productName.ts) ----

test.describe('cleanProductName', () => {
  test('strips trailing size token and title-cases a shouty USDA name', () => {
    expect(cleanProductName('365 ORGANIC TAHINI 16OZ')).toBe('365 Organic Tahini');
  });

  test('strips the leading brand token only when it equals the brand field', () => {
    expect(cleanProductName('365 ORGANIC TAHINI 16OZ', '365')).toBe('Organic Tahini');
    // Brand doesn't prefix the name -> untouched.
    expect(cleanProductName('ORGANIC ROLLED OATS 454G', 'Whole Foods Market')).toBe('Organic Rolled Oats');
  });

  test('brand strip requires a token boundary (365 never eats into 3650)', () => {
    expect(cleanProductName('3650 FOO', '365')).toBe('3650 Foo');
  });

  test('strips repeated trailing size/count tokens', () => {
    expect(cleanProductName('TAHINI 16 OZ 2 PACK')).toBe('Tahini');
    expect(cleanProductName('COCONUT WATER 12 FL OZ')).toBe('Coconut Water');
  });

  test('does not strip trailing numbers without a unit (e.g. formula stages)', () => {
    expect(cleanProductName('FORMULA STAGE 2')).toBe('Formula Stage 2');
  });

  test('preserves existing mixed-case words', () => {
    expect(cleanProductName('McCormick Ground Cinnamon')).toBe('McCormick Ground Cinnamon');
  });

  test('falls back to the raw name when everything would be stripped', () => {
    expect(cleanProductName('16OZ')).toBe('16OZ');
  });
});
