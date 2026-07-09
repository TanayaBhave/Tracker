// GI-ready report (Phase 4, W6c): a one-page, printable summary a parent hands
// to their pediatric GI doctor. Pick a date range, see a clean report, hit
// "Print / Save as PDF" (window.print() + print-only CSS — no PDF library).
// No in-app entry point yet: a later integration step wires a Settings button
// to open this. Renders as a full-screen overlay (not the usual bottom-sheet
// slide-up — a printable report needs the full page, not a capped-height
// sheet), so it takes only `onClose`, no `onSave`.
//
// Pure computation (date-range filtering, tallying, the suspect-label
// exposure builder, burp-vs-vomit grouping) is factored into exported
// functions below so tests/gi-report.spec.ts can unit-test them directly,
// same convention as src/nutrition/blend.ts + tests/blend.spec.ts.
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, SETTINGS_ID, addDaysLocal, todayStr } from '../db';
import {
  computeLabelRates, gapsBeforeEach, longestGapDays,
} from '../insights/engine';
import type { LabelRate, LabelledExposure } from '../insights/engine';

// ---- Pure helpers (exported for unit tests; no Dexie/React inside) ----

/** The YYYY-MM-DD prefix of either a `date` field or an ISO `timestamp` —
 *  both compare correctly against a plain date-range boundary this way. */
export function dateKey(ts: string): string {
  return ts.slice(0, 10);
}

/** Inclusive on both ends: a record dated exactly `start` or `end` counts. */
export function inRange(ts: string, start: string, end: string): boolean {
  const d = dateKey(ts);
  return d >= start && d <= end;
}

export interface MealExposureInput {
  timestamp: string;
  foodItems: { ingredientIds: string[] }[];
  texture?: string;
}

/** Builds the `LabelledExposure[]` the insights engine expects: every meal
 *  contributes its ingredients (resolved to display names, deduped, order
 *  preserved) plus its texture (prefixed "Texture: " so it can never collide
 *  with an identically-named ingredient and reads clearly in the report
 *  table). A meal with neither just contributes an empty label list, which
 *  is harmless (computeLabelRates skips it). */
export function buildLabelledExposures(
  meals: MealExposureInput[],
  ingredientNames: Map<string, string>,
): LabelledExposure[] {
  return meals.map((meal) => {
    const ids = meal.foodItems.flatMap((fi) => fi.ingredientIds);
    const names = ids.map((id) => ingredientNames.get(id) ?? id);
    const labels = [...new Set(names)];
    if (meal.texture) labels.push(`Texture: ${meal.texture}`);
    return { timestamp: meal.timestamp, labels };
  });
}

/** computeLabelRates() is sorted by label (for determinism); the report
 *  wants the suspect table sorted by rate, worst first — re-sorted here
 *  rather than in the engine, per the engine's own documented contract. */
export function sortRatesDesc(rates: LabelRate[]): LabelRate[] {
  return [...rates].sort((a, b) => b.rate - a.rate);
}

/** Counts occurrences of each defined value, skipping `undefined` entries
 *  entirely (an optional field that was never filled in isn't "a value that
 *  occurred zero times", it's "not recorded" — so it's simply absent from
 *  the result rather than reported as 0). */
export function tallyDefined<T extends string>(values: (T | undefined)[]): Partial<Record<T, number>> {
  const out: Partial<Record<T, number>> = {};
  for (const v of values) {
    if (v === undefined) continue;
    out[v] = (out[v] ?? 0) + 1;
  }
  return out;
}

/** bile-green or blood-streaked appearance, or projectile forcefulness —
 *  CLAUDE.md's explicit red flags that should prompt contacting the doctor. */
export function isRedFlagVomit(v: { appearance?: string; forcefulness?: string }): boolean {
  return v.appearance === 'bile-green' || v.appearance === 'bloody-streak' || v.forcefulness === 'projectile';
}

export interface VomitSummaryInput {
  severity: string;
  forcefulness?: string;
  appearance?: string;
}

export interface VomitSummary {
  total: number;
  bySeverity: Partial<Record<string, number>>;
  byForcefulness: Partial<Record<string, number>>;
  byAppearance: Partial<Record<string, number>>;
  redFlagCount: number;
}

export function vomitSummary(vomits: VomitSummaryInput[]): VomitSummary {
  return {
    total: vomits.length,
    bySeverity: tallyDefined(vomits.map((v) => v.severity)),
    byForcefulness: tallyDefined(vomits.map((v) => v.forcefulness)),
    byAppearance: tallyDefined(vomits.map((v) => v.appearance)),
    redFlagCount: vomits.filter(isRedFlagVomit).length,
  };
}

export interface MealBurpInput {
  id: string;
  reaction: string;
  burped?: string; // 'yes' | 'no' | 'partial'
}

export interface VomitLinkInput {
  linkedMealId?: string;
}

/** A meal "caused" a vomit if it was tagged `reaction: 'vomited'` at meal
 *  time, OR a separately-logged VomitEvent links back to it via
 *  `linkedMealId` — either signal counts, matching how the Timeline already
 *  flags meals (`m.reaction === 'vomited'`). */
export function didMealCauseVomit(meal: { id: string; reaction: string }, vomits: VomitLinkInput[]): boolean {
  return meal.reaction === 'vomited' || vomits.some((v) => v.linkedMealId === meal.id);
}

export interface GroupStat {
  count: number;
  vomited: number;
  rate: number; // vomited / count; 0 if count === 0
}

export interface BurpVomitStats {
  burped: GroupStat;   // burped === 'yes' | 'partial'
  notBurped: GroupStat; // burped === 'no'
}

/** Two-group comparison: among meals where burping was attempted (yes or
 *  partial) vs meals where it explicitly failed (no), what fraction were
 *  followed by vomiting? Meals with `burped` left unset fall into neither
 *  bucket (unknown, not "no"). */
export function burpVomitStats(meals: MealBurpInput[], vomits: VomitLinkInput[]): BurpVomitStats {
  const burpedMeals = meals.filter((m) => m.burped === 'yes' || m.burped === 'partial');
  const notBurpedMeals = meals.filter((m) => m.burped === 'no');
  const group = (list: MealBurpInput[]): GroupStat => {
    const count = list.length;
    const vomited = list.filter((m) => didMealCauseVomit(m, vomits)).length;
    return { count, vomited, rate: count === 0 ? 0 : vomited / count };
  };
  return { burped: group(burpedMeals), notBurped: group(notBurpedMeals) };
}

// ---- Display labels (small, stable — duplicated rather than imported, same
// convention as ManualNutritionSheet's NUTRIENT_FIELDS / CATEGORY_OPTIONS) ----

const SEVERITY_LABELS: Record<string, string> = {
  'spit-up': 'Spit-up', moderate: 'Moderate', large: 'Large',
};
const FORCE_LABELS: Record<string, string> = {
  effortless: 'Effortless', moderate: 'Moderate', projectile: 'Projectile',
};
const APPEARANCE_LABELS: Record<string, string> = {
  'milky-undigested': 'Milky / undigested',
  'partially-digested': 'Partially digested',
  mucousy: 'Mucousy',
  'bloody-streak': 'Bloody streak',
  'bile-green': 'Bile-green',
  other: 'Other',
};
const LEVEL_LABELS: Record<string, string> = { less: 'Less', regular: 'Regular', more: 'More' };
const ORAL_MOTOR_LABELS: Record<string, string> = {
  'ate-smoothly': 'Ate smoothly',
  gagged: 'Gagged',
  'coughed-choked': 'Coughed / choked',
  'spit-food-out': 'Spit food out',
  'pocketed-in-cheeks': 'Pocketed in cheeks',
  'trouble-swallowing': 'Trouble swallowing',
  'tongue-thrust': 'Tongue thrust',
};

function TallyRows({ tally, labelMap }: { tally: Partial<Record<string, number>>; labelMap: Record<string, string> }) {
  const entries = Object.entries(tally).filter(([, n]) => (n ?? 0) > 0);
  if (entries.length === 0) return <div className="hint">None recorded in this range.</div>;
  return (
    <>
      {entries.map(([key, n]) => (
        <div className="entry" key={key}>
          <div className="body">
            <div className="title">{labelMap[key] ?? key}</div>
          </div>
          <div className="meta" style={{ alignSelf: 'center', paddingLeft: 6 }}>{n}</div>
        </div>
      ))}
    </>
  );
}

export function GIReportSheet({ onClose }: { onClose: () => void }) {
  const [start, setStart] = useState(() => addDaysLocal(todayStr(), -30));
  const [end, setEnd] = useState(() => todayStr());

  const settings = useLiveQuery(() => db.settings.get(SETTINGS_ID), []);
  const meals = useLiveQuery(() => db.meals.where('deleted').equals(0).toArray(), [], []);
  const vomits = useLiveQuery(() => db.vomits.where('deleted').equals(0).toArray(), [], []);
  const stools = useLiveQuery(() => db.stools.where('deleted').equals(0).toArray(), [], []);
  const gassiness = useLiveQuery(() => db.gassiness.where('deleted').equals(0).toArray(), [], []);
  const activity = useLiveQuery(() => db.activity.where('deleted').equals(0).toArray(), [], []);
  const weights = useLiveQuery(() => db.weights.where('deleted').equals(0).toArray(), [], []);
  const symptoms = useLiveQuery(() => db.symptoms.where('deleted').equals(0).toArray(), [], []);
  const ingredients = useLiveQuery(() => db.ingredients.where('deleted').equals(0).toArray(), [], []);

  const ingredientNames = useMemo(
    () => new Map(ingredients.map((i) => [i.id, i.name] as const)),
    [ingredients],
  );

  const mealsInRange = useMemo(() => meals.filter((m) => inRange(m.timestamp, start, end)), [meals, start, end]);
  const vomitsInRange = useMemo(() => vomits.filter((v) => inRange(v.timestamp, start, end)), [vomits, start, end]);
  const stoolsInRange = useMemo(() => stools.filter((s) => inRange(s.timestamp, start, end)), [stools, start, end]);
  const gasInRange = useMemo(() => gassiness.filter((g) => inRange(g.date, start, end)), [gassiness, start, end]);
  const activityInRange = useMemo(() => activity.filter((a) => inRange(a.date, start, end)), [activity, start, end]);
  const weightsInRange = useMemo(
    () => weights.filter((w) => inRange(w.date, start, end)).sort((a, b) => a.date.localeCompare(b.date)),
    [weights, start, end],
  );
  const symptomsInRange = useMemo(
    () => symptoms.filter((s) => inRange(s.date, start, end) && s.flags.length > 0)
      .sort((a, b) => a.date.localeCompare(b.date)),
    [symptoms, start, end],
  );

  const windowHours = settings?.associationWindowHours ?? 2;
  const rates = useMemo(() => {
    const exposures = buildLabelledExposures(mealsInRange, ingredientNames);
    const outcomes = vomitsInRange.map((v) => ({ timestamp: v.timestamp }));
    return sortRatesDesc(computeLabelRates(exposures, outcomes, windowHours));
  }, [mealsInRange, vomitsInRange, ingredientNames, windowHours]);

  const vSummary = useMemo(() => vomitSummary(vomitsInRange), [vomitsInRange]);
  const redFlagVomits = useMemo(() => vomitsInRange.filter(isRedFlagVomit), [vomitsInRange]);
  const gasTally = useMemo(() => tallyDefined(gasInRange.map((g) => g.level)), [gasInRange]);
  const activityTally = useMemo(() => tallyDefined(activityInRange.map((a) => a.level)), [activityInRange]);
  const oralTally = useMemo(
    () => tallyDefined(mealsInRange.flatMap((m) => m.oralMotorTags ?? [])),
    [mealsInRange],
  );
  const burpStats = useMemo(() => burpVomitStats(mealsInRange, vomitsInRange), [mealsInRange, vomitsInRange]);
  const longestStoolGap = useMemo(() => longestGapDays(stoolsInRange.map((s) => s.timestamp)), [stoolsInRange]);
  const stoolGaps = useMemo(
    () => gapsBeforeEach(stoolsInRange.map((s) => s.timestamp).sort()).filter((g): g is number => g !== undefined),
    [stoolsInRange],
  );

  const rangeLabel = `${start} to ${end}`;

  return (
    <div className="sheet-backdrop gi-report-backdrop">
      <style>{`
        .gi-report-backdrop { align-items: stretch !important; }
        .gi-report { background: var(--paper); width: 100%; max-width: 560px; margin: 0 auto; min-height: 100%; display: flex; flex-direction: column; }
        .gi-report-header { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: calc(env(safe-area-inset-top) + 14px) 14px 12px; border-bottom: 1px solid var(--line-soft); }
        .gi-report-header h2 { flex: 1; margin: 0; font-size: 17px; font-weight: 700; text-align: center; color: var(--ink); }
        .gi-report-body { flex: 1; overflow-y: auto; padding: 16px 18px calc(env(safe-area-inset-bottom) + 30px); }
        .gi-report-range { display: flex; gap: 10px; }
        .gi-report-range .field { flex: 1; }
        .gi-report table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .gi-report table th, .gi-report table td { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--line-soft); }
        .gi-report table th { color: var(--ink-soft); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
        .gi-report table td { color: var(--ink); }
        @media print {
          .nav, .topbar, .gi-no-print { display: none !important; }
          body, .app, .content, .gi-report-backdrop, .gi-report, .gi-report-body {
            background: #fff !important; position: static !important; inset: auto !important;
          }
          .gi-report, .gi-report * { color: #000 !important; box-shadow: none !important; }
          .gi-report .warn-banner, .gi-report .warn-banner * {
            color: #b00000 !important; border-color: #b00000 !important;
            -webkit-print-color-adjust: exact; print-color-adjust: exact;
          }
          .gi-report table th, .gi-report table td, .gi-report .entry { border-color: #ccc !important; }
        }
      `}
      </style>
      <div className="gi-report">
        <div className="gi-report-header gi-no-print">
          <button type="button" className="btn ghost" onClick={onClose}>Close</button>
          <h2>GI Visit Report</h2>
          <button type="button" className="btn save" onClick={() => window.print()}>Print / Save as PDF</button>
        </div>
        <div className="gi-report-body">
          <div className="gi-report-range gi-no-print">
            <div className="field">
              <label>Start date</label>
              <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="field">
              <label>End date</label>
              <input type="date" value={end} min={start} max={todayStr()} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>

          <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--ink-soft)', margin: '-6px 0 14px' }}>
            {rangeLabel}
          </div>

          <div className="warn-banner">
            Descriptive, not diagnostic — this report spots patterns to discuss with your pediatrician; it does not
            establish cause.
          </div>

          {redFlagVomits.length > 0 && (
            <div className="warn-banner">
              <strong>{redFlagVomits.length} red-flag vomiting event{redFlagVomits.length === 1 ? '' : 's'} in this range</strong>
              {' '}(bile-green or bloody-streaked appearance, or projectile force) — contact your pediatrician.
              {redFlagVomits.map((v) => (
                <div key={v.id} style={{ marginTop: 6 }}>
                  {dateKey(v.timestamp)} — {v.appearance ? APPEARANCE_LABELS[v.appearance] ?? v.appearance : ''}
                  {v.forcefulness === 'projectile' ? ' · projectile' : ''}
                </div>
              ))}
            </div>
          )}

          <div className="section-label">Weight trend</div>
          {weightsInRange.length === 0 ? (
            <div className="hint">No weight entries in this range.</div>
          ) : (
            weightsInRange.map((w) => (
              <div className="entry" key={w.id}>
                <div className="body">
                  <div className="title">{w.date}</div>
                </div>
                <div className="meta" style={{ alignSelf: 'center', paddingLeft: 6 }}>{w.weight} {w.unit}</div>
              </div>
            ))
          )}

          <div className="section-label">Vomit frequency, forcefulness &amp; appearance</div>
          <div className="hint" style={{ margin: '-4px 2px 10px' }}>
            {vSummary.total} vomit event{vSummary.total === 1 ? '' : 's'} logged in this range.
          </div>
          {vSummary.total > 0 && (
            <>
              <TallyRows tally={vSummary.bySeverity} labelMap={SEVERITY_LABELS} />
              <div className="hint" style={{ margin: '10px 2px 4px' }}>By forcefulness</div>
              <TallyRows tally={vSummary.byForcefulness} labelMap={FORCE_LABELS} />
              <div className="hint" style={{ margin: '10px 2px 4px' }}>By appearance</div>
              <TallyRows tally={vSummary.byAppearance} labelMap={APPEARANCE_LABELS} />
            </>
          )}

          <div className="section-label">Suspect food / ingredient / texture table</div>
          <div className="hint" style={{ margin: '-4px 2px 10px' }}>
            Rate = vomits within {windowHours}h of a meal containing this label, ÷ exposures. Small samples are noisy
            — always read the raw counts, not just the rate.
          </div>
          {rates.length === 0 ? (
            <div className="hint">No meals with ingredients/texture logged in this range.</div>
          ) : (
            <table>
              <thead>
                <tr><th>Label</th><th>Exposures</th><th>Outcomes</th><th>Rate</th></tr>
              </thead>
              <tbody>
                {rates.map((r) => (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td>{r.exposures}</td>
                    <td>{r.outcomes}</td>
                    <td>{Math.round(r.rate * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="section-label">Daily gassiness</div>
          <TallyRows tally={gasTally} labelMap={LEVEL_LABELS} />

          <div className="section-label">Daily physical activity</div>
          <TallyRows tally={activityTally} labelMap={LEVEL_LABELS} />

          <div className="section-label">Stool frequency &amp; constipation gaps</div>
          <div className="hint" style={{ margin: '-4px 2px 10px' }}>
            {stoolsInRange.length} stool event{stoolsInRange.length === 1 ? '' : 's'} logged
            {stoolGaps.length > 0 && ` · longest gap between stools: ${longestStoolGap.toFixed(1)} day${longestStoolGap === 1 ? '' : 's'}`}.
          </div>

          <div className="section-label">Oral-motor sign frequency</div>
          <TallyRows tally={oralTally} labelMap={ORAL_MOTOR_LABELS} />

          <div className="section-label">Burp success vs. vomiting</div>
          <table>
            <thead>
              <tr><th>Group</th><th>Meals</th><th>Vomited after</th><th>Rate</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>Burped (yes/partial)</td>
                <td>{burpStats.burped.count}</td>
                <td>{burpStats.burped.vomited}</td>
                <td>{Math.round(burpStats.burped.rate * 100)}%</td>
              </tr>
              <tr>
                <td>Not burped</td>
                <td>{burpStats.notBurped.count}</td>
                <td>{burpStats.notBurped.vomited}</td>
                <td>{Math.round(burpStats.notBurped.rate * 100)}%</td>
              </tr>
            </tbody>
          </table>

          <div className="section-label">Symptom-flag timeline</div>
          {symptomsInRange.length === 0 ? (
            <div className="hint">No symptom flags logged in this range.</div>
          ) : (
            symptomsInRange.map((s) => (
              <div className="entry" key={s.id}>
                <div className="body">
                  <div className="title">{s.date}</div>
                  <div className="meta">{s.flags.join(' · ')}</div>
                </div>
              </div>
            ))
          )}

          <div className="warn-banner" style={{ marginTop: 18 }}>
            Descriptive, not diagnostic — bring anything notable in this report to your pediatrician's attention.
          </div>
        </div>
      </div>
    </div>
  );
}
