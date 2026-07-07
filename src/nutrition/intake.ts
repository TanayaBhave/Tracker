// Daily nutrition totals for the Nutrition tab (NutritionDay.tsx).
import { db, isoToLocal, NUTRIENT_KEYS } from '../db';
import type { NutrientProfile } from '../db';

export type DailyIntake = NutrientProfile & {
  /** Human-readable coverage stat, e.g. "based on 4 of 6 items". */
  coverage: string;
  itemsWithData: number;
  itemsTotal: number;
  /** Medication doses whose linked catalog item contributed perDose nutrients. */
  supplementDoses: number;
};

/** How many "default doses" a logged medication dose represents, for scaling
 *  the catalog item's perDose nutrients.
 *
 *  Scaled by amount ratio ONLY when the logged dose amount and the catalog's
 *  default dose amount are both present AND the units match (case-insensitive)
 *  — 2.5 ml of a "5 ml per dose" syrup is half a dose. Any other combination
 *  (missing amounts, unit mismatch like "drops" vs "ml", or a nonsensical
 *  default of <= 0) counts as exactly ONE dose: without a shared unit there is
 *  no meaningful ratio, and one-dose is the honest default for "gave the
 *  usual dose, didn't type the numbers". */
export function doseScaleFactor(
  doseAmount: number | undefined,
  doseUnit: string | undefined,
  defaultDoseAmount: number | undefined,
  defaultDoseUnit: string | undefined,
): number {
  if (
    doseAmount === undefined || defaultDoseAmount === undefined
    || !doseUnit || !defaultDoseUnit
    || doseUnit.trim().toLowerCase() !== defaultDoseUnit.trim().toLowerCase()
    || !(defaultDoseAmount > 0) || !(doseAmount >= 0)
  ) {
    return 1;
  }
  return doseAmount / defaultDoseAmount;
}

/** Sums per100 x amount/100 across every food item logged for `dateStr`
 *  (local calendar date, matching how Timeline.tsx buckets events), plus the
 *  perDose nutrients of that day's medication doses that link a MedCatalogItem
 *  carrying a perDose profile (supplements), plus a coverage stat for how many
 *  logged items actually had USDA nutrition data.
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

  // Supplement doses: a med dose linked to a catalog item with perDose adds
  // perDose x doseScaleFactor to the day's totals.
  let supplementDoses = 0;
  const meds = await db.meds.where('deleted').equals(0).toArray();
  for (const dose of meds) {
    if (isoToLocal(dose.timestamp).slice(0, 10) !== dateStr) continue;
    if (!dose.catalogId) continue;
    const cat = await db.medCatalog.get(dose.catalogId);
    if (!cat || cat.deleted !== 0 || !cat.perDose) continue;

    supplementDoses += 1;
    const factor = doseScaleFactor(
      dose.doseAmount, dose.doseUnit, cat.defaultDoseAmount, cat.defaultDoseUnit,
    );
    for (const key of NUTRIENT_KEYS) {
      const v = cat.perDose[key];
      if (v === undefined) continue;
      totals[key] = (totals[key] ?? 0) + v * factor;
    }
  }

  return {
    ...totals,
    itemsTotal,
    itemsWithData,
    supplementDoses,
    coverage: `based on ${itemsWithData} of ${itemsTotal} item${itemsTotal === 1 ? '' : 's'}`,
  };
}
