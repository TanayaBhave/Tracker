// WHO Child Growth Standards — Weight-for-age, Boys, Birth to 24 Months.
// LMS parameters (lambda/mu/sigma), one row per completed month of age.
//
// Fetched from the CDC-hosted WHO growth chart data files on 2026-07-06:
//   https://www.cdc.gov/growthcharts/who-data-files.htm
//   https://ftp.cdc.gov/pub/Health_Statistics/NCHS/growthcharts/WHO-Boys-Weight-for-age-Percentiles.csv
// (CDC republishes the WHO Child Growth Standards LMS tables verbatim for clinical use;
// this is the same 0–2y reference used by US pediatric growth-chart software.)
// Embedded as static data per project policy — never re-derived from model memory.
export const whoWfaBoys: { month: number; L: number; M: number; S: number }[] = [
  { month: 0, L: 0.3487, M: 3.3464, S: 0.14602 },
  { month: 1, L: 0.2297, M: 4.4709, S: 0.13395 },
  { month: 2, L: 0.197, M: 5.5675, S: 0.12385 },
  { month: 3, L: 0.1738, M: 6.3762, S: 0.11727 },
  { month: 4, L: 0.1553, M: 7.0023, S: 0.11316 },
  { month: 5, L: 0.1395, M: 7.5105, S: 0.1108 },
  { month: 6, L: 0.1257, M: 7.934, S: 0.10958 },
  { month: 7, L: 0.1134, M: 8.297, S: 0.10902 },
  { month: 8, L: 0.1021, M: 8.6151, S: 0.10882 },
  { month: 9, L: 0.0917, M: 8.9014, S: 0.10881 },
  { month: 10, L: 0.082, M: 9.1649, S: 0.10891 },
  { month: 11, L: 0.073, M: 9.4122, S: 0.10906 },
  { month: 12, L: 0.0644, M: 9.6479, S: 0.10925 },
  { month: 13, L: 0.0563, M: 9.8749, S: 0.10949 },
  { month: 14, L: 0.0487, M: 10.0953, S: 0.10976 },
  { month: 15, L: 0.0413, M: 10.3108, S: 0.11007 },
  { month: 16, L: 0.0343, M: 10.5228, S: 0.11041 },
  { month: 17, L: 0.0275, M: 10.7319, S: 0.11079 },
  { month: 18, L: 0.0211, M: 10.9385, S: 0.11119 },
  { month: 19, L: 0.0148, M: 11.143, S: 0.11164 },
  { month: 20, L: 0.0087, M: 11.3462, S: 0.11211 },
  { month: 21, L: 0.0029, M: 11.5486, S: 0.11261 },
  { month: 22, L: -0.0028, M: 11.7504, S: 0.11314 },
  { month: 23, L: -0.0083, M: 11.9514, S: 0.11369 },
  { month: 24, L: -0.0137, M: 12.1515, S: 0.11426 },
];

/**
 * Linearly interpolate L/M/S for a fractional corrected age in months.
 * Clamps to [0, 24] (the WHO weight-for-age range used here).
 */
export function whoWfaBoysAt(ageMonths: number): { L: number; M: number; S: number } {
  const clamped = Math.min(Math.max(ageMonths, 0), 24);
  const lo = Math.floor(clamped);
  const hi = Math.min(lo + 1, 24);
  const row = (m: number) => whoWfaBoys[m];
  if (lo === hi) return row(lo);
  const frac = clamped - lo;
  const a = row(lo);
  const b = row(hi);
  return {
    L: a.L + (b.L - a.L) * frac,
    M: a.M + (b.M - a.M) * frac,
    S: a.S + (b.S - a.S) * frac,
  };
}
