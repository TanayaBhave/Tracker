// Pure Dexie-record -> engine.ts-shape adapters for the Plot Builder (W6b,
// Phase 4). No I/O here (no Dexie, no React) — PlotBuilder.tsx does the
// useLiveQuery reads and passes plain record arrays in, same separation of
// concerns as src/nutrition/blend.ts and src/insights/engine.ts itself.
import type { LabelledExposure, DurationInterval } from './engine';

// ---- Saved-view config shape (also imported by src/db.ts for the SavedView
// record) — must stay plain-JSON-serializable (no functions/class instances)
// since it round-trips through Dexie and the sync server's JSON payload column. ----

export type LabelCategory = 'ingredients' | 'textures' | 'both';

/** What's being measured (the "Y axis"). `factor-scale` treats every logged
 *  event of the chosen scale-kind Factor as one outcome instance, ignoring
 *  its numeric `value` — a deliberate simplification for correlation-frequency
 *  purposes (rate = how often it happens, not weighted by how severe). */
export type OutcomeChoice =
  | { kind: 'vomit' }
  | { kind: 'gas-more' }
  | { kind: 'stool-problem' }
  | { kind: 'factor-scale'; factorId: string };

export type PlotMode = 'labels' | 'duration' | 'timeseries';

/** What the "labels" mode correlates the outcome against — either a
 *  categorical attribute of meals (ingredients/textures/both, as before), OR
 *  another single-instance EVENT signal (vomit/gassiness/stool/a scale
 *  Factor) treated as one fixed-name label per occurrence. This is what lets
 *  "does gassiness precede vomiting?" or "does a stool problem precede
 *  vomiting?" be asked with the exact same per-label rate math as an
 *  ingredient correlation — any signal that can be an OutcomeChoice can
 *  equally be used as a label source. Nested under `kind` rather than
 *  flattening into LabelCategory so the existing meal-based shape/tests are
 *  untouched. */
export type LabelSource =
  | { kind: 'meal'; category: LabelCategory }
  | { kind: 'event'; event: OutcomeChoice };

export interface PlotConfig {
  rangeStart: string; // YYYY-MM-DD, inclusive
  rangeEnd: string; // YYYY-MM-DD, inclusive
  outcome: OutcomeChoice;
  mode: PlotMode;
  labelSource: LabelSource; // used when mode === 'labels'
  durationFactorId?: string; // used when mode === 'duration'
  bucket: 'day' | 'week' | 'month'; // used when mode === 'timeseries'
}

// ---- Date-range filtering ----

/** Whole-day inclusive range check: `rangeStart`/`rangeEnd` are YYYY-MM-DD
 *  local-calendar-day strings; `timestamp` is a full ISO instant. Parsed via
 *  the local timezone (no 'Z'/offset on the range boundary strings), matching
 *  how `<input type="date">` values are treated everywhere else in this app. */
export function inDateRange(timestamp: string, rangeStart: string, rangeEnd: string): boolean {
  const t = new Date(timestamp).getTime();
  const startMs = new Date(`${rangeStart}T00:00:00`).getTime();
  const endMs = new Date(`${rangeEnd}T23:59:59.999`).getTime();
  return t >= startMs && t <= endMs;
}

/** Turns a YYYY-MM-DD daily-record date (gassiness/activity/etc. have no
 *  `timestamp`, just a `date`) into a full local-time string anchored at
 *  local noon, so it can be fed into the association-window engine functions
 *  alongside real timestamped events. Local noon (no 'Z'/offset, so it parses
 *  in the browser's local timezone) avoids any midnight-boundary mismatch
 *  against `inDateRange`'s local-midnight range boundaries above. */
export function dateOnlyToLocalNoon(date: string): string {
  return `${date}T12:00:00`;
}

// ---- Outcome helpers ----

/** The two "problem" directions for stool consistency singled out by
 *  CLAUDE.md's outcome list (constipation and its opposite), rather than the
 *  full 5-value Bristol-style enum. */
export function isProblemStoolConsistency(consistency: string): boolean {
  return consistency === 'hard' || consistency === 'loose' || consistency === 'watery';
}

export interface EventSourceData {
  vomits: { timestamp: string }[];
  gassiness: { date: string; level: string }[];
  stools: { timestamp: string; consistency: string }[];
  factorEvents: { factorId: string; timestamp?: string }[];
}

/** Raw (not yet date-range-filtered) timestamps for one OutcomeChoice signal
 *  — shared by both the "outcome" (Y axis) and, now, the "labels" mode's
 *  event-based label sources (X axis), since either role can use any of
 *  these same underlying signals. `gas-more`/daily records get anchored to
 *  local noon (see dateOnlyToLocalNoon) so they slot into the same
 *  timestamp-based association-window math as real instants. */
export function eventTimestampsFor(choice: OutcomeChoice, data: EventSourceData): string[] {
  switch (choice.kind) {
    case 'vomit':
      return data.vomits.map((v) => v.timestamp);
    case 'gas-more':
      return data.gassiness.filter((g) => g.level === 'more').map((g) => dateOnlyToLocalNoon(g.date));
    case 'stool-problem':
      return data.stools.filter((s) => isProblemStoolConsistency(s.consistency)).map((s) => s.timestamp);
    case 'factor-scale':
      return data.factorEvents
        .filter((e) => e.factorId === choice.factorId && e.timestamp)
        .map((e) => e.timestamp as string);
    default:
      return [];
  }
}

/** Human-readable name for an OutcomeChoice — used for both the outcome
 *  picker's option labels and, when a signal is chosen as a label source
 *  instead, as the single fixed label name every one of its exposures
 *  carries (e.g. every "gassiness (more)" day becomes one exposure labeled
 *  exactly "Gassiness (more)"). */
export function outcomeChoiceLabel(choice: OutcomeChoice, factorNameById: Map<string, string>): string {
  switch (choice.kind) {
    case 'vomit': return 'Vomit';
    case 'gas-more': return 'Gassiness (more)';
    case 'stool-problem': return 'Stool (hard/loose/watery)';
    case 'factor-scale': return factorNameById.get(choice.factorId) ?? 'Factor';
    default: return 'Unknown';
  }
}

// ---- Label/exposure helpers (meal -> LabelledExposure) ----

export interface MealForExposure {
  timestamp: string;
  texture?: string;
  foodItems: { ingredientIds: string[]; catalogId?: string }[];
}

/** Every distinct label one meal carries for the chosen category: ingredient
 *  ids (from the food item itself, unioned with its linked FoodCatalogItem's
 *  own ingredientIds — same "union" idea as blend.ts's unionIngredientIds, see
 *  that file for the precedent this mirrors) and/or the meal's texture. */
export function mealLabels(
  meal: MealForExposure,
  catalogIngredientIds: Record<string, string[]>,
  category: LabelCategory,
): string[] {
  const labels = new Set<string>();
  if (category === 'ingredients' || category === 'both') {
    for (const item of meal.foodItems) {
      for (const id of item.ingredientIds) labels.add(id);
      if (item.catalogId) {
        for (const id of catalogIngredientIds[item.catalogId] ?? []) labels.add(id);
      }
    }
  }
  if (category === 'textures' || category === 'both') {
    if (meal.texture) labels.add(meal.texture);
  }
  return Array.from(labels);
}

/** Maps a list of meals (already date-range-filtered by the caller) into the
 *  `LabelledExposure[]` shape computeLabelRates expects. A meal that ends up
 *  with zero labels for the chosen category still becomes an exposure with an
 *  empty `labels` array — it simply never contributes to any label's count,
 *  which is correct (nothing to attribute it to), not an error. */
export function mealsToExposures(
  meals: MealForExposure[],
  catalogIngredientIds: Record<string, string[]>,
  category: LabelCategory,
): LabelledExposure[] {
  return meals.map((meal) => ({
    timestamp: meal.timestamp,
    labels: mealLabels(meal, catalogIngredientIds, category),
  }));
}

// ---- Duration-factor helpers (FactorEvent -> DurationInterval) ----

export interface FactorEventForDuration {
  deleted: number; // 0 | 1
  startTime?: string;
  endTime?: string;
}

/** Non-deleted, closed (has both startTime and endTime) FactorEvents only —
 *  an open-ended event (a car ride still in progress) has no end yet, so it's
 *  skipped rather than guessed at. */
export function factorEventsToDurationIntervals(
  events: FactorEventForDuration[],
): DurationInterval[] {
  return events
    .filter((e): e is FactorEventForDuration & { startTime: string; endTime: string } =>
      e.deleted === 0 && !!e.startTime && !!e.endTime)
    .map((e) => ({ start: e.startTime, end: e.endTime }));
}

// ---- Time bucketing (outcome count per day/week — no engine.ts function
// needed, this is a plain groupBy-and-count over timestamps) ----

export interface BucketCount {
  bucket: string; // YYYY-MM-DD: the day itself, or the Monday of the week
  count: number;
}

function localDayKey(ts: string): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Monday-anchored week start (local calendar), as a YYYY-MM-DD key. */
function localWeekKey(ts: string): string {
  const d = new Date(ts);
  const dow = d.getDay(); // 0 = Sun .. 6 = Sat
  const diffToMonday = (dow + 6) % 7; // Mon -> 0, Tue -> 1, ..., Sun -> 6
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - diffToMonday);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const day = String(monday.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Calendar-month key (YYYY-MM), for "how many per month over the whole
 *  year" views — e.g. vomit or gassiness frequency across many months. */
function localMonthKey(ts: string): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Counts how many timestamps fall in each day/week/month bucket, sorted
 *  ascending by bucket key. Buckets with zero events are simply absent (not
 *  zero-filled) — the caller decides whether to fill gaps for a continuous
 *  chart axis. */
export function bucketCounts(timestamps: string[], bucket: 'day' | 'week' | 'month'): BucketCount[] {
  const key = bucket === 'day' ? localDayKey : bucket === 'week' ? localWeekKey : localMonthKey;
  const counts = new Map<string, number>();
  for (const ts of timestamps) {
    const k = key(ts);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([b, count]) => ({ bucket: b, count }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}
