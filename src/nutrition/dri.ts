// Age-bracket Dietary Reference Intake (DRI) targets, used as the %DRI
// denominators in NutritionDay. Every value below was verified via WebFetch
// against a primary source at implementation time (NIH Office of Dietary
// Supplements health-professional fact sheets, or the NASEM/IOM "Dietary
// Reference Intakes" summary tables mirrored on NCBI Bookshelf) — never from
// model memory. See the per-row source URL comments.
//
// Cross-workstream contract (docs/ROADMAP.md Phase 3): W5 owns
// src/growth/age.ts and exports correctedAgeMonths(dob, gestWeeks, gestDays,
// onDate?) — imported here to pick the infant vs. child bracket.
import type { NutrientProfile } from '../db';
import { correctedAgeMonths } from '../growth/age';

export type DriBracket = 'infant7_12' | 'child1_3';

export const DRI_BRACKET_LABEL: Record<DriBracket, string> = {
  infant7_12: '7–12 months',
  child1_3: '1–3 years',
};

// ---- Infants, 7-12 months ----
const infant7_12: NutrientProfile = {
  // Reference EER ~635-757 kcal/day across the 7-12mo span (IOM equation
  // TEE = 89*weight(kg) - 100, plus a small growth-energy-deposition term),
  // computed against WHO 50th-percentile weights-for-age; midpoint used below.
  // https://pmc.ncbi.nlm.nih.gov/articles/PMC8575726/
  kcal: 700,
  // RDA — NASEM DRI Table C-4 "Recommended Intakes for Individuals, Macronutrients":
  // https://www.ncbi.nlm.nih.gov/books/NBK208874/
  protein_g: 13.5,
  // fat_g intentionally omitted: no AMDR is established for infants under 12
  // months (fat is deliberately unrestricted at this age — breast milk/formula
  // is ~50% fat by calories). Table C-5 (same source above) starts at "Children,
  // 1-3 y". NutritionDay skips the %DRI bar for fat in this bracket rather than
  // inventing a denominator.
  // fiber_g intentionally omitted: listed "ND" (not determined) for infants,
  // same Table C-4.
  carbs_g: 95, // RDA, Table C-4 (same source as protein_g above).
  iron_mg: 11, // RDA — https://ods.od.nih.gov/factsheets/Iron-HealthProfessional/
  calcium_mg: 260, // AI — https://ods.od.nih.gov/factsheets/Calcium-HealthProfessional/
  zinc_mg: 3, // RDA — https://ods.od.nih.gov/factsheets/Zinc-HealthProfessional/
  vitD_ug: 10, // AI, 400 IU — https://ods.od.nih.gov/factsheets/VitaminD-HealthProfessional/
  vitC_mg: 50, // AI — https://ods.od.nih.gov/factsheets/VitaminC-HealthProfessional/
  vitA_ug_rae: 500, // AI — https://ods.od.nih.gov/factsheets/VitaminA-HealthProfessional/
  // AI, 2019 Sodium/Potassium DRI update — https://www.ncbi.nlm.nih.gov/books/NBK545442/?report=printable
  potassium_mg: 860,
  sodium_mg: 370,
  folate_ug: 80, // AI — https://ods.od.nih.gov/factsheets/Folate-HealthProfessional/
  vitB12_ug: 0.5, // AI — https://ods.od.nih.gov/factsheets/VitaminB12-HealthProfessional/
};

// ---- Children, 1-3 years ----
const child1_3: NutrientProfile = {
  // Reference EER ~988 kcal/day (IOM: 89*12kg - 100 + 20, ~12kg reference
  // toddler weight), cross-checked against the 24-month figure (980 kcal/day)
  // in https://pmc.ncbi.nlm.nih.gov/articles/PMC8575726/. Rounded to 1000.
  kcal: 1000,
  protein_g: 13, // RDA, Table C-4: https://www.ncbi.nlm.nih.gov/books/NBK208874/
  // No direct gram RDA exists for fat at this age — derived from the AMDR
  // (Table C-5, same source): 30-40% of energy, midpoint 35% of the 1000kcal
  // target above at 9 kcal/g: (1000 * 0.35) / 9 ~= 38.9g.
  fat_g: 39,
  carbs_g: 130, // RDA, Table C-4.
  fiber_g: 19, // AI, Table C-4.
  iron_mg: 7, // RDA — https://ods.od.nih.gov/factsheets/Iron-HealthProfessional/
  calcium_mg: 700, // RDA — https://ods.od.nih.gov/factsheets/Calcium-HealthProfessional/
  zinc_mg: 3, // RDA — https://ods.od.nih.gov/factsheets/Zinc-HealthProfessional/
  vitD_ug: 15, // RDA, 600 IU — https://ods.od.nih.gov/factsheets/VitaminD-HealthProfessional/
  vitC_mg: 15, // RDA — https://ods.od.nih.gov/factsheets/VitaminC-HealthProfessional/
  vitA_ug_rae: 300, // RDA — https://ods.od.nih.gov/factsheets/VitaminA-HealthProfessional/
  // AI, 2019 Sodium/Potassium DRI update — https://www.ncbi.nlm.nih.gov/books/NBK545442/?report=printable
  potassium_mg: 2000,
  sodium_mg: 800,
  folate_ug: 150, // RDA — https://ods.od.nih.gov/factsheets/Folate-HealthProfessional/
  vitB12_ug: 0.9, // RDA — https://ods.od.nih.gov/factsheets/VitaminB12-HealthProfessional/
};

export const DRI_TARGETS: Record<DriBracket, NutrientProfile> = { infant7_12, child1_3 };

/** Selects the infant/child DRI bracket from corrected age. Only two brackets
 *  are modeled (matching this app's only trackers so far); a baby just outside
 *  7-12mo/1-3y still gets the nearer bracket rather than no comparison at all. */
export function driBracketFor(correctedMonths: number): DriBracket {
  return correctedMonths < 12 ? 'infant7_12' : 'child1_3';
}

/** DRI targets + bracket label for a baby's settings, as of an optional date
 *  (YYYY-MM-DD; defaults to "today" inside correctedAgeMonths). Returns
 *  undefined until DOB is set — there's no age to bracket on yet. */
export function driForSettings(
  dob: string | undefined,
  gestWeeksAtBirth: number | undefined,
  gestDaysAtBirth: number | undefined,
  onDate?: string,
): { bracket: DriBracket; label: string; targets: NutrientProfile } | undefined {
  if (!dob) return undefined;
  const months = correctedAgeMonths(dob, gestWeeksAtBirth ?? 40, gestDaysAtBirth ?? 0, onDate);
  const bracket = driBracketFor(months);
  return { bracket, label: DRI_BRACKET_LABEL[bracket], targets: DRI_TARGETS[bracket] };
}
