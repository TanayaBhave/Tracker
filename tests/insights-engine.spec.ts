import { test, expect } from 'playwright/test';
import {
  computeLabelRates, computeDurationFactorBaseline, gapsBeforeEach, longestGapDays,
} from '../src/insights/engine';

// Pure-function unit tests for the Phase 4 insights engine (no browser
// needed) — run with `npx playwright test tests/insights-engine.spec.ts`.

test.describe('computeLabelRates', () => {
  test('a label on 2 exposures, one followed by an outcome in-window and one not', () => {
    const exposures = [
      { timestamp: '2026-01-01T08:00:00', labels: ['sweet-potato'] },
      { timestamp: '2026-01-02T08:00:00', labels: ['sweet-potato'] },
    ];
    const outcomes = [
      { timestamp: '2026-01-01T09:00:00' }, // 1h after the first exposure -> in window
      // second exposure has no outcome within window
    ];
    const [rate] = computeLabelRates(exposures, outcomes, 2);
    expect(rate).toEqual({ label: 'sweet-potato', exposures: 2, outcomes: 1, rate: 0.5 });
  });

  test('an outcome exactly at the window boundary counts; just past it does not', () => {
    const exposures = [{ timestamp: '2026-01-01T08:00:00', labels: ['x'] }];
    const atBoundary = computeLabelRates(
      exposures,
      [{ timestamp: '2026-01-01T10:00:00' }], // exactly 2h later
      2,
    );
    expect(atBoundary[0].outcomes).toBe(1);

    const pastBoundary = computeLabelRates(
      exposures,
      [{ timestamp: '2026-01-01T10:00:00.001' }], // 2h and 1ms later
      2,
    );
    expect(pastBoundary[0].outcomes).toBe(0);
  });

  test('an outcome before the exposure (negative delta) never counts', () => {
    const exposures = [{ timestamp: '2026-01-01T08:00:00', labels: ['x'] }];
    const outcomes = [{ timestamp: '2026-01-01T07:59:59' }];
    const [rate] = computeLabelRates(exposures, outcomes, 2);
    expect(rate.outcomes).toBe(0);
    expect(rate.rate).toBe(0);
  });

  test('an outcome simultaneous with the exposure never counts (strictly after only)', () => {
    const exposures = [{ timestamp: '2026-01-01T08:00:00', labels: ['x'] }];
    const outcomes = [{ timestamp: '2026-01-01T08:00:00' }];
    const [rate] = computeLabelRates(exposures, outcomes, 2);
    expect(rate.outcomes).toBe(0);
  });

  test('a label with zero exposures never appears in the output', () => {
    const exposures = [{ timestamp: '2026-01-01T08:00:00', labels: ['x'] }];
    const result = computeLabelRates(exposures, [], 2);
    expect(result.map((r) => r.label)).toEqual(['x']);
    expect(result.find((r) => r.label === 'y')).toBeUndefined();
  });

  test('one exposure followed by two outcomes in its window -> outcomes=2, rate=2.0 (double-counting is intentional)', () => {
    const exposures = [{ timestamp: '2026-01-01T08:00:00', labels: ['lumpy'] }];
    const outcomes = [
      { timestamp: '2026-01-01T09:00:00' },
      { timestamp: '2026-01-01T09:30:00' },
    ];
    const [rate] = computeLabelRates(exposures, outcomes, 2);
    expect(rate).toEqual({ label: 'lumpy', exposures: 1, outcomes: 2, rate: 2.0 });
  });

  test('the same outcome falling within two different exposures\' windows counts toward the label twice', () => {
    const exposures = [
      { timestamp: '2026-01-01T08:00:00', labels: ['lumpy'] },
      { timestamp: '2026-01-01T09:00:00', labels: ['lumpy'] },
    ];
    const outcomes = [{ timestamp: '2026-01-01T09:30:00' }]; // within window of both exposures
    const [rate] = computeLabelRates(exposures, outcomes, 2);
    expect(rate.exposures).toBe(2);
    expect(rate.outcomes).toBe(2); // counted once per exposure it was in-window for
  });

  test('windowHours <= 0 means every label has outcomes=0 but exposures still accurate', () => {
    const exposures = [
      { timestamp: '2026-01-01T08:00:00', labels: ['a'] },
      { timestamp: '2026-01-01T09:00:00', labels: ['a', 'b'] },
    ];
    const outcomes = [{ timestamp: '2026-01-01T09:30:00' }];

    const zeroWindow = computeLabelRates(exposures, outcomes, 0);
    expect(zeroWindow).toEqual([
      { label: 'a', exposures: 2, outcomes: 0, rate: 0 },
      { label: 'b', exposures: 1, outcomes: 0, rate: 0 },
    ]);

    const negativeWindow = computeLabelRates(exposures, outcomes, -5);
    expect(negativeWindow.every((r) => r.outcomes === 0)).toBe(true);
    expect(negativeWindow.every((r) => r.rate === 0)).toBe(true);
  });

  test('output sorted by label ascending, not by rate or exposure count', () => {
    const exposures = [
      { timestamp: '2026-01-01T08:00:00', labels: ['zebra'] },
      { timestamp: '2026-01-01T08:00:00', labels: ['apple'] },
      { timestamp: '2026-01-01T08:00:00', labels: ['mango'] },
    ];
    const result = computeLabelRates(exposures, [], 2);
    expect(result.map((r) => r.label)).toEqual(['apple', 'mango', 'zebra']);
  });

  test('a meal with multiple labels contributes its outcome count to every label', () => {
    const exposures = [
      { timestamp: '2026-01-01T08:00:00', labels: ['sweet-potato', 'lumpy'] },
    ];
    const outcomes = [{ timestamp: '2026-01-01T09:00:00' }];
    const result = computeLabelRates(exposures, outcomes, 2);
    expect(result).toEqual([
      { label: 'lumpy', exposures: 1, outcomes: 1, rate: 1 },
      { label: 'sweet-potato', exposures: 1, outcomes: 1, rate: 1 },
    ]);
  });

  test('no exposures at all yields an empty array', () => {
    expect(computeLabelRates([], [{ timestamp: '2026-01-01T08:00:00' }], 2)).toEqual([]);
  });
});

test.describe('computeDurationFactorBaseline', () => {
  test('an outcome inside an interval counts toward insideCount; one outside counts toward outsideCount', () => {
    const intervals = [{ start: '2026-01-01T10:00:00', end: '2026-01-01T12:00:00' }];
    const outcomes = [
      { timestamp: '2026-01-01T11:00:00' }, // inside
      { timestamp: '2026-01-01T14:00:00' }, // outside
    ];
    const result = computeDurationFactorBaseline(
      intervals,
      outcomes,
      '2026-01-01T00:00:00',
      '2026-01-01T24:00:00',
    );
    expect(result.insideCount).toBe(1);
    expect(result.outsideCount).toBe(1);
    expect(result.insideHours).toBeCloseTo(2, 6);
    expect(result.outsideHours).toBeCloseTo(22, 6);
    expect(result.insideRate).toBeCloseTo(0.5, 6);
    expect(result.outsideRate).toBeCloseTo(1 / 22, 6);
  });

  test('an outcome exactly on the interval start/end boundary counts as inside', () => {
    const intervals = [{ start: '2026-01-01T10:00:00', end: '2026-01-01T12:00:00' }];
    const result = computeDurationFactorBaseline(
      intervals,
      [{ timestamp: '2026-01-01T10:00:00' }, { timestamp: '2026-01-01T12:00:00' }],
      '2026-01-01T00:00:00',
      '2026-01-01T24:00:00',
    );
    expect(result.insideCount).toBe(2);
    expect(result.outsideCount).toBe(0);
  });

  test('an interval extending past rangeEnd is clipped to the range bounds', () => {
    const intervals = [{ start: '2026-01-01T22:00:00', end: '2026-01-02T06:00:00' }];
    const result = computeDurationFactorBaseline(
      intervals,
      [],
      '2026-01-01T00:00:00',
      '2026-01-01T24:00:00',
    );
    // Only the 2h from 22:00 to midnight falls inside the range.
    expect(result.insideHours).toBeCloseTo(2, 6);
    expect(result.outsideHours).toBeCloseTo(22, 6);
  });

  test('intervals/outcomes entirely outside the range are ignored', () => {
    const intervals = [{ start: '2026-02-01T00:00:00', end: '2026-02-01T02:00:00' }];
    const result = computeDurationFactorBaseline(
      intervals,
      [{ timestamp: '2026-02-01T01:00:00' }],
      '2026-01-01T00:00:00',
      '2026-01-01T24:00:00',
    );
    expect(result.insideHours).toBe(0);
    expect(result.insideCount).toBe(0);
    expect(result.outsideCount).toBe(0); // the outcome is entirely outside the range, so it's ignored too
    expect(result.outsideHours).toBeCloseTo(24, 6);
  });

  test('overlapping intervals: insideHours double-counts overlap time, but insideCount never double-counts a single outcome', () => {
    // Two overlapping car-ride intervals both covering 11:00-13:00.
    const intervals = [
      { start: '2026-01-01T10:00:00', end: '2026-01-01T13:00:00' }, // 3h
      { start: '2026-01-01T11:00:00', end: '2026-01-01T14:00:00' }, // 3h, overlaps 11:00-13:00 with the first
    ];
    const outcomes = [{ timestamp: '2026-01-01T12:00:00' }]; // falls inside both intervals' overlap
    const result = computeDurationFactorBaseline(
      intervals,
      outcomes,
      '2026-01-01T00:00:00',
      '2026-01-01T24:00:00',
    );
    // insideHours is the naive sum of each interval's clipped duration: 3 + 3 = 6h,
    // even though the intervals overlap for 2 of those hours (this is the
    // documented caller-responsibility behavior, not a bug).
    expect(result.insideHours).toBeCloseTo(6, 6);
    // But the single outcome in the overlap is counted once, not twice.
    expect(result.insideCount).toBe(1);
  });

  test('no intervals at all: everything is outside, insideRate is 0 (no division by zero)', () => {
    const result = computeDurationFactorBaseline(
      [],
      [{ timestamp: '2026-01-01T11:00:00' }],
      '2026-01-01T00:00:00',
      '2026-01-01T24:00:00',
    );
    expect(result.insideHours).toBe(0);
    expect(result.insideCount).toBe(0);
    expect(result.insideRate).toBe(0);
    expect(result.outsideCount).toBe(1);
    expect(result.outsideHours).toBeCloseTo(24, 6);
  });
});

test.describe('gapsBeforeEach', () => {
  test('first timestamp has an undefined gap; later ones get days since the previous', () => {
    const gaps = gapsBeforeEach([
      '2026-01-01T00:00:00',
      '2026-01-04T00:00:00',
      '2026-01-05T12:00:00',
    ]);
    expect(gaps).toHaveLength(3);
    expect(gaps[0]).toBeUndefined();
    expect(gaps[1]).toBeCloseTo(3, 6);
    expect(gaps[2]).toBeCloseTo(1.5, 6);
  });

  test('unsorted input is sorted internally before computing gaps', () => {
    const gaps = gapsBeforeEach(['2026-01-05T00:00:00', '2026-01-01T00:00:00', '2026-01-03T00:00:00']);
    expect(gaps[0]).toBeUndefined();
    expect(gaps[1]).toBeCloseTo(2, 6);
    expect(gaps[2]).toBeCloseTo(2, 6);
  });

  test('empty and single-element input never throw', () => {
    expect(gapsBeforeEach([])).toEqual([]);
    expect(gapsBeforeEach(['2026-01-01T00:00:00'])).toEqual([undefined]);
  });
});

test.describe('longestGapDays', () => {
  test('returns the largest gap among several', () => {
    const days = longestGapDays([
      '2026-01-01T00:00:00',
      '2026-01-02T00:00:00',
      '2026-01-06T00:00:00', // 4-day gap, the largest
      '2026-01-07T00:00:00',
    ]);
    expect(days).toBeCloseTo(4, 6);
  });

  test('fewer than 2 timestamps returns 0, not NaN or a thrown error', () => {
    expect(longestGapDays([])).toBe(0);
    expect(longestGapDays(['2026-01-01T00:00:00'])).toBe(0);
  });
});
