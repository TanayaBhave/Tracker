// LMS (lambda-mu-sigma) z-score math shared by the WHO and Fenton growth charts.
// Pure functions only — no data, no I/O. See whoWfaBoys.ts / fentonBoys.ts for the
// actual reference tables.

const L_EPSILON = 1e-6; // treat |L| below this as the "L == 0" special case

/**
 * Z-score of `value` given the LMS parameters at that age.
 * Standard Cole/WHO LMS formula: z = ((v/M)^L − 1) / (L·S), with the L→0
 * limiting case z = ln(v/M) / S (a Box-Cox transform with L=0 is a log transform).
 */
export function zFromValue(value: number, L: number, M: number, S: number): number {
  if (Math.abs(L) < L_EPSILON) {
    return Math.log(value / M) / S;
  }
  return (Math.pow(value / M, L) - 1) / (L * S);
}

/** Inverse of zFromValue: the measurement value at a given z-score. */
export function valueFromZ(z: number, L: number, M: number, S: number): number {
  if (Math.abs(L) < L_EPSILON) {
    return M * Math.exp(S * z);
  }
  return M * Math.pow(1 + L * S * z, 1 / L);
}

// Abramowitz & Stegun 7.1.26 erf approximation (max absolute error ~1.5e-7).
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const poly = ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t;
  const y = 1 - poly * Math.exp(-ax * ax);
  return sign * y;
}

/**
 * Standard-normal CDF of `z`, expressed as a percentile in [0, 100].
 * Φ(z) = 0.5 * (1 + erf(z / sqrt(2))).
 */
export function percentileFromZ(z: number): number {
  return 50 * (1 + erf(z / Math.SQRT2));
}
