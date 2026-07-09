// Pure math for the Phase 4 insights layer — association-window correlation
// (which ingredients/tags/textures precede an outcome, and how often) and
// duration-factor pre/post baseline comparison (e.g. car rides vs no car
// rides). No I/O here (no Dexie, no React, no Date.now()); callers (Plot
// Builder, GI PDF report) fetch+filter Dexie records and pass plain
// timestamp/label data in, same separation of concerns as src/nutrition/blend.ts.

/** A single occurrence of something the user wants to correlate against an
 *  outcome — e.g. one meal, tagged with every ingredient id / ingredient-tag
 *  id / texture value it carries. `labels` lets one exposure count toward
 *  several different label buckets at once (a meal with sweet potato AND
 *  lumpy texture contributes to both "sweet potato" and "lumpy" stats). */
export interface LabelledExposure {
  timestamp: string; // ISO
  labels: string[]; // e.g. ingredient ids, ingredient-tag ids, or a texture string
}

/** A single occurrence of the thing being measured — a vomit event, a
 *  gassiness log entry, etc. No labels: outcomes are what you're measuring
 *  FOR, not measuring BY. */
export interface OutcomeEvent {
  timestamp: string; // ISO
}

export interface LabelRate {
  label: string;
  exposures: number; // total exposures carrying this label, in the caller's date range
  outcomes: number; // total OUTCOME EVENTS attributed to this label (see below)
  rate: number; // outcomes / exposures; 0 when exposures === 0 (never NaN/Infinity)
}

/**
 * For every distinct label appearing on any exposure, counts:
 *  - exposures: how many exposures carry that label.
 *  - outcomes: how many outcome events fall strictly after an exposure
 *    carrying that label, within `windowHours` of it (an outcome at exactly
 *    `windowHours` later counts as associated; uses `outcomeTime - exposureTime
 *    <= windowHours * 3600_000` and `> 0`, i.e. the outcome must come after
 *    the exposure, not simultaneous or before it).
 *  - rate: outcomes / exposures.
 *
 * Important, non-obvious design decision: this counts every (exposure, outcome)
 * pair that falls in-window, NOT "did this exposure have >=1 outcome" as a
 * 0/1 flag. So if one meal is followed by two vomit events within the window,
 * every label on that meal gets +2 to its outcome count, not +1 — and if a
 * label appears on two different meals that are each followed by the same
 * single outcome event (overlapping windows), that outcome counts toward the
 * label twice (once per exposure it was in-window for). This means `rate` can
 * exceed 1.0 in edge cases — that's correct, not a bug: it reflects that this
 * is a raw-count correlation signal, not a probability, which is exactly why
 * the caller must always display the raw `exposures`/`outcomes` counts
 * alongside `rate`, never the rate alone (small samples are noisy).
 *
 * `windowHours` <= 0 is treated as "no exposures ever qualify" — every
 * exposure still gets counted (so `exposures` stays accurate), but no
 * outcome can ever satisfy the `> 0` half of the window check, so `outcomes`
 * is always 0 for every label. Does not throw on non-positive windowHours.
 *
 * Sort order: returned array is sorted by `label` ascending (stable,
 * deterministic for tests/rendering) — NOT by rate or exposure count; the
 * caller decides display sort order.
 */
export function computeLabelRates(
  exposures: LabelledExposure[],
  outcomes: OutcomeEvent[],
  windowHours: number,
): LabelRate[] {
  const windowMs = windowHours * 3_600_000;
  const outcomeTimes = outcomes.map((o) => new Date(o.timestamp).getTime());

  const exposureCounts = new Map<string, number>();
  const outcomeCounts = new Map<string, number>();

  for (const exposure of exposures) {
    const exposureTime = new Date(exposure.timestamp).getTime();

    // Count how many outcomes fall in-window for this single exposure once,
    // then apply that count to every label this exposure carries.
    let inWindow = 0;
    for (const outcomeTime of outcomeTimes) {
      const delta = outcomeTime - exposureTime;
      if (delta > 0 && delta <= windowMs) inWindow += 1;
    }

    for (const label of exposure.labels) {
      exposureCounts.set(label, (exposureCounts.get(label) ?? 0) + 1);
      if (inWindow > 0) {
        outcomeCounts.set(label, (outcomeCounts.get(label) ?? 0) + inWindow);
      }
    }
  }

  const labels = Array.from(exposureCounts.keys()).sort();
  return labels.map((label) => {
    const labelExposures = exposureCounts.get(label) ?? 0;
    const labelOutcomes = outcomeCounts.get(label) ?? 0;
    return {
      label,
      exposures: labelExposures,
      outcomes: labelOutcomes,
      rate: labelExposures === 0 ? 0 : labelOutcomes / labelExposures,
    };
  });
}

/** One instance of a duration-kind Factor (e.g. one car ride, one nap gap) —
 *  or any other bounded time interval you want to test as a "were we inside
 *  this vs outside it" baseline. */
export interface DurationInterval {
  start: string; // ISO
  end: string; // ISO
}

export interface BaselineComparison {
  insideCount: number; // outcome events whose timestamp falls within any interval [start, end]
  insideHours: number; // total hours covered by the (caller-provided, already-deduplicated/merged if needed) intervals, clipped to [rangeStart, rangeEnd]
  insideRate: number; // insideCount / insideHours; 0 if insideHours === 0
  outsideCount: number; // outcome events NOT inside any interval, within [rangeStart, rangeEnd]
  outsideHours: number; // (rangeEnd - rangeStart) in hours, minus insideHours
  outsideRate: number; // outsideCount / outsideHours; 0 if outsideHours === 0
}

/**
 * Compares an outcome's rate (events per hour) while "inside" any of the
 * given duration intervals against the baseline rate "outside" them, both
 * clipped to [rangeStart, rangeEnd] — this is how a duration Factor like a
 * car ride or a sleep gap gets tested against a baseline, per the app's
 * "pre/post comparison for duration Factors" analysis view. An outcome
 * exactly on an interval boundary (start or end) counts as inside (i.e.
 * inside test is `t >= start && t <= end`).
 *
 * Does NOT merge overlapping intervals for you — if the caller passes
 * overlapping intervals, insideHours is computed by clipping/summing each
 * interval independently, which double-counts overlapping time. This is
 * documented as the caller's responsibility (merge overlapping intervals
 * before calling, if that matters for their use case) rather than silently
 * merged — silently merging would surprise a caller who intentionally wants
 * per-interval totals for some other reason. Outcomes are never
 * double-counted even if they fall in the overlap of two intervals (a given
 * outcome is either inside-at-least-one-interval or not, counted once).
 *
 * Outcomes/intervals entirely outside [rangeStart, rangeEnd] are ignored.
 */
export function computeDurationFactorBaseline(
  intervals: DurationInterval[],
  outcomes: OutcomeEvent[],
  rangeStart: string,
  rangeEnd: string,
): BaselineComparison {
  const rangeStartMs = new Date(rangeStart).getTime();
  const rangeEndMs = new Date(rangeEnd).getTime();
  const rangeMs = Math.max(0, rangeEndMs - rangeStartMs);

  // Clip each interval to [rangeStart, rangeEnd] independently and sum
  // durations — intentionally not merged, per the documented contract.
  let insideMs = 0;
  const clippedIntervals: { start: number; end: number }[] = [];
  for (const interval of intervals) {
    const startMs = Math.max(rangeStartMs, new Date(interval.start).getTime());
    const endMs = Math.min(rangeEndMs, new Date(interval.end).getTime());
    if (endMs > startMs) {
      insideMs += endMs - startMs;
      clippedIntervals.push({ start: startMs, end: endMs });
    }
  }

  let insideCount = 0;
  let outsideCount = 0;
  for (const outcome of outcomes) {
    const t = new Date(outcome.timestamp).getTime();
    if (t < rangeStartMs || t > rangeEndMs) continue; // entirely outside the range, ignored

    const isInside = clippedIntervals.some((iv) => t >= iv.start && t <= iv.end);
    if (isInside) {
      insideCount += 1;
    } else {
      outsideCount += 1;
    }
  }

  const insideHours = insideMs / 3_600_000;
  const outsideHours = (rangeMs - insideMs) / 3_600_000;

  return {
    insideCount,
    insideHours,
    insideRate: insideHours === 0 ? 0 : insideCount / insideHours,
    outsideCount,
    outsideHours,
    outsideRate: outsideHours === 0 ? 0 : outsideCount / outsideHours,
  };
}
