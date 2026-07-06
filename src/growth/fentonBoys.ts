// Fenton 2013 Preterm Growth Chart — Boys, weight-for-postmenstrual-age.
// Source: Fenton TR, Kim JH. A systematic review and meta-analysis to revise the
// Fenton growth chart for preterm infants. BMC Pediatr. 2013;13:59 (open access,
// free for non-commercial use). https://doi.org/10.1186/1471-2431-13-59
//
// The paper's own "Data availability" statement points to the exact calculator
// spreadsheet as the canonical source of the underlying LMS/percentile tables:
// http://ucalgary.ca/fenton — fetched 2026-07-06 from the University of Calgary
// hosted file:
//   https://ucalgary.ca/live-uc-ucalgary-site/sites/default/files/teams/418/clinical-exact-age-calculator-fenton-2013-growth-chart-v7.xlsx
// (co-authored by Tanis Fenton with Timothy P Stevens MD MPH, University of Rochester;
// the workbook's "Boys" sheet embeds the precomputed weight L/M/S and 3rd/10th/50th/
// 90th/97th percentile-in-grams reference table this data is transcribed from). Values
// below are converted g -> kg (3 dp). The weight domain in the source spreadsheet
// starts at 22.5 weeks PMA (labelled "22.5-50 wks"), hence the half-week first row.
//
// Used for the historical view of early (preterm-era) weights only, PMA <= 50 weeks —
// Fenton 2013 hands off to the WHO standard at 50 weeks PMA (= 10 weeks corrected age).
export const fentonBoys: { pmaWeeks: number; p3: number; p10: number; p50: number; p90: number; p97: number }[] = [
  { pmaWeeks: 22.5, p3: 0.402, p10: 0.442, p50: 0.533, p90: 0.629, p97: 0.676 },
  { pmaWeeks: 23, p3: 0.42, p10: 0.466, p50: 0.571, p90: 0.68, p97: 0.732 },
  { pmaWeeks: 24, p3: 0.455, p10: 0.517, p50: 0.651, p90: 0.788, p97: 0.852 },
  { pmaWeeks: 25, p3: 0.491, p10: 0.572, p50: 0.741, p90: 0.909, p97: 0.986 },
  { pmaWeeks: 26, p3: 0.528, p10: 0.631, p50: 0.841, p90: 1.042, p97: 1.133 },
  { pmaWeeks: 27, p3: 0.568, p10: 0.697, p50: 0.953, p90: 1.189, p97: 1.295 },
  { pmaWeeks: 28, p3: 0.617, p10: 0.775, p50: 1.079, p90: 1.354, p97: 1.475 },
  { pmaWeeks: 29, p3: 0.682, p10: 0.869, p50: 1.223, p90: 1.538, p97: 1.677 },
  { pmaWeeks: 30, p3: 0.774, p10: 0.987, p50: 1.388, p90: 1.746, p97: 1.903 },
  { pmaWeeks: 31, p3: 0.901, p10: 1.133, p50: 1.578, p90: 1.98, p97: 2.157 },
  { pmaWeeks: 32, p3: 1.065, p10: 1.309, p50: 1.79, p90: 2.235, p97: 2.434 },
  { pmaWeeks: 33, p3: 1.259, p10: 1.509, p50: 2.018, p90: 2.503, p97: 2.723 },
  { pmaWeeks: 34, p3: 1.475, p10: 1.726, p50: 2.255, p90: 2.774, p97: 3.014 },
  { pmaWeeks: 35, p3: 1.701, p10: 1.952, p50: 2.493, p90: 3.039, p97: 3.296 },
  { pmaWeeks: 36, p3: 1.926, p10: 2.176, p50: 2.726, p90: 3.293, p97: 3.564 },
  { pmaWeeks: 37, p3: 2.142, p10: 2.391, p50: 2.947, p90: 3.53, p97: 3.811 },
  { pmaWeeks: 38, p3: 2.347, p10: 2.596, p50: 3.156, p90: 3.752, p97: 4.042 },
  { pmaWeeks: 39, p3: 2.543, p10: 2.794, p50: 3.36, p90: 3.969, p97: 4.268 },
  { pmaWeeks: 40, p3: 2.736, p10: 2.989, p50: 3.568, p90: 4.194, p97: 4.503 },
  { pmaWeeks: 41, p3: 2.927, p10: 3.188, p50: 3.785, p90: 4.437, p97: 4.76 },
  { pmaWeeks: 42, p3: 3.12, p10: 3.391, p50: 4.014, p90: 4.7, p97: 5.041 },
  { pmaWeeks: 43, p3: 3.312, p10: 3.596, p50: 4.251, p90: 4.976, p97: 5.34 },
  { pmaWeeks: 44, p3: 3.504, p10: 3.801, p50: 4.492, p90: 5.259, p97: 5.646 },
  { pmaWeeks: 45, p3: 3.696, p10: 4.007, p50: 4.732, p90: 5.541, p97: 5.95 },
  { pmaWeeks: 46, p3: 3.89, p10: 4.213, p50: 4.967, p90: 5.812, p97: 6.241 },
  { pmaWeeks: 47, p3: 4.084, p10: 4.417, p50: 5.195, p90: 6.07, p97: 6.514 },
  { pmaWeeks: 48, p3: 4.275, p10: 4.617, p50: 5.416, p90: 6.316, p97: 6.774 },
  { pmaWeeks: 49, p3: 4.459, p10: 4.809, p50: 5.63, p90: 6.554, p97: 7.025 },
  { pmaWeeks: 50, p3: 4.631, p10: 4.991, p50: 5.835, p90: 6.789, p97: 7.275 },
];
