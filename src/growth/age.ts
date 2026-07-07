// Age helpers for a baby born preterm.
//
// Cross-workstream contract (Phase 3, docs/ROADMAP.md): W5 (this file) owns
// correctedAgeMonths() and chronologicalAgeMonths(); W4 (nutrition) imports
// chronologicalAgeMonths() to select DRI brackets (the nutritionist tracks
// this baby by chronological, not corrected, age) and for other age-dependent
// logic. Keep the signatures stable.

const DAYS_PER_MONTH = 365.25 / 12; // 30.4375 — average Gregorian month
const TERM_GESTATION_DAYS = 280; // standard 40-week term pregnancy, LMP-based

function daysBetween(fromISODate: string, toISODate: string): number {
  // Anchor both dates at UTC midnight so DST/timezone never shifts the day count —
  // inputs are plain YYYY-MM-DD (date-only) strings, e.g. from AppSettings.dob.
  const from = new Date(`${fromISODate}T00:00:00Z`).getTime();
  const to = new Date(`${toISODate}T00:00:00Z`).getTime();
  return (to - from) / 86_400_000;
}

/**
 * Corrected age, in months, as of `onDate` (defaults to today).
 *
 * corrected age (days) = chronological age (days) − (280 − gestation-at-birth-in-days)
 * i.e. corrected age is the time elapsed since the baby's *due date*, not birth date.
 * `gestWeeks`/`gestDays` describe gestation completed at birth (gestDays is the
 * 0–6 extra days past the week count), so gestation-at-birth = gestWeeks*7 + gestDays.
 */
export function correctedAgeMonths(
  dob: string,
  gestWeeks: number,
  gestDays: number,
  onDate?: string,
): number {
  const today = onDate ?? new Date().toISOString().slice(0, 10);
  const chronologicalDays = daysBetween(dob, today);
  const gestationAtBirthDays = gestWeeks * 7 + gestDays;
  const prematureByDays = TERM_GESTATION_DAYS - gestationAtBirthDays;
  const correctedDays = chronologicalDays - prematureByDays;
  return correctedDays / DAYS_PER_MONTH;
}

/**
 * Chronological age, in months, as of `onDate` (defaults to today) — the
 * baby's actual time-since-birth, with no preterm adjustment. Used where the
 * "corrected age" convention doesn't apply, e.g. the nutritionist's DRI
 * bracket, which tracks chronological age only.
 */
export function chronologicalAgeMonths(dob: string, onDate?: string): number {
  const today = onDate ?? new Date().toISOString().slice(0, 10);
  return daysBetween(dob, today) / DAYS_PER_MONTH;
}

/**
 * Postmenstrual age (PMA), in weeks, as of `onDate` (defaults to today):
 * gestational age at birth + chronological time elapsed since birth.
 * Used to place weights on the Fenton 2013 preterm chart (valid to ~50 weeks PMA).
 */
export function postmenstrualAgeWeeks(
  dob: string,
  gestWeeks: number,
  gestDays: number,
  onDate?: string,
): number {
  const today = onDate ?? new Date().toISOString().slice(0, 10);
  const chronologicalWeeks = daysBetween(dob, today) / 7;
  return gestWeeks + gestDays / 7 + chronologicalWeeks;
}
