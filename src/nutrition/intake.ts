// Daily nutrition totals for the Nutrition tab (NutritionDay.tsx).
import { db, isoToLocal } from '../db';
import type { NutrientProfile } from '../db';

export type DailyIntake = NutrientProfile & {
  /** Human-readable coverage stat, e.g. "based on 4 of 6 items". */
  coverage: string;
  itemsWithData: number;
  itemsTotal: number;
};

const NUTRIENT_KEYS: (keyof NutrientProfile)[] = [
  'kcal', 'protein_g', 'fat_g', 'carbs_g', 'fiber_g', 'iron_mg', 'calcium_mg',
  'zinc_mg', 'vitD_ug', 'vitC_mg', 'vitA_ug_rae', 'potassium_mg', 'sodium_mg',
  'folate_ug', 'vitB12_ug',
];

/** Sums per100 x amount/100 across every food item logged for `dateStr`
 *  (local calendar date, matching how Timeline.tsx buckets events), plus a
 *  coverage stat for how many logged items actually had USDA nutrition data.
 *
 *  Uses `amountConsumed`, falling back to `amountGiven` when "eaten" wasn't
 *  recorded — a deliberate looseness (rather than only ever using
 *  amountConsumed) so a meal where only "given" was logged still counts
 *  toward today's totals instead of silently dropping out. */
export async function computeDailyIntake(dateStr: string): Promise<DailyIntake> {
  const meals = await db.meals.where('deleted').equals(0).toArray();
  const totals: NutrientProfile = {};
  let itemsTotal = 0;
  let itemsWithData = 0;

  for (const meal of meals) {
    if (isoToLocal(meal.timestamp).slice(0, 10) !== dateStr) continue;
    for (const item of meal.foodItems) {
      itemsTotal += 1;
      if (!item.catalogId) continue;
      const amount = item.amountConsumed ?? item.amountGiven;
      if (amount === undefined) continue;
      const dish = await db.foodCatalog.get(item.catalogId);
      const per100 = dish?.per100;
      if (!per100) continue;

      itemsWithData += 1;
      const factor = amount / 100;
      for (const key of NUTRIENT_KEYS) {
        const v = per100[key];
        if (v === undefined) continue;
        totals[key] = (totals[key] ?? 0) + v * factor;
      }
    }
  }

  return {
    ...totals,
    itemsTotal,
    itemsWithData,
    coverage: `based on ${itemsWithData} of ${itemsTotal} item${itemsTotal === 1 ? '' : 's'}`,
  };
}
