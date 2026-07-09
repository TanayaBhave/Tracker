// Plot Builder (Phase 4, W6b): the flexible outcome-vs-label plotter described
// in CLAUDE.md's "Insights — the flexible plotter" section. Reads Dexie
// directly (meals, vomits, gassiness, stools, factors, factorEvents,
// ingredients, foodCatalog, settings, savedViews) — no props. All correlation
// math is delegated to src/insights/engine.ts (a fixed, already-tested
// contract); this file's own job is fetching+filtering Dexie records into the
// shapes engine.ts expects (via src/insights/adapters.ts) and rendering them.
//
// Not yet reachable from app navigation — a later integration step wires this
// into ChartsScreen.tsx. See tests/plot-builder.spec.ts for pure-function
// coverage of the adapters this component relies on.
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  db, SETTINGS_ID, baseFields, todayStr, addDaysLocal,
} from '../db';
import type { SavedView } from '../db';
import { Field, ChipSelect } from './Fields';
import { computeLabelRates, computeDurationFactorBaseline } from '../insights/engine';
import {
  mealsToExposures, factorEventsToDurationIntervals, bucketCounts,
  inDateRange, isProblemStoolConsistency, dateOnlyToLocalNoon,
} from '../insights/adapters';
import type { OutcomeChoice, LabelCategory, PlotConfig, PlotMode } from '../insights/adapters';

// Single-series bar fill — literal hex per this app's dark-theme Recharts
// convention (SVG marks can't reliably use var(--...) cross-browser on iOS
// Safari), reusing --accent's current value.
const ACCENT = '#5B8DEF';
const CALM = '#3E7C6C'; // var(--calm), for the "outside window" comparison bar

// Outcome selection is modeled as a string union so it drops straight into
// ChipSelect<T extends string> — `factor:<id>` carries the chosen scale
// Factor's id. Converted to/from the richer OutcomeChoice discriminated union
// (which is what's actually persisted in PlotConfig) at the edges.
type OutcomeKey = 'vomit' | 'gas-more' | 'stool-problem' | `factor:${string}`;

function outcomeToKey(outcome: OutcomeChoice): OutcomeKey {
  return outcome.kind === 'factor-scale' ? `factor:${outcome.factorId}` : outcome.kind;
}
function keyToOutcome(key: OutcomeKey): OutcomeChoice {
  if (key.startsWith('factor:')) return { kind: 'factor-scale', factorId: key.slice('factor:'.length) };
  return { kind: key as 'vomit' | 'gas-more' | 'stool-problem' };
}

function defaultRangeStart(): string {
  return addDaysLocal(todayStr(), -13); // 14-day window by default (inclusive of today)
}

export function PlotBuilder() {
  const [rangeStart, setRangeStart] = useState(defaultRangeStart());
  const [rangeEnd, setRangeEnd] = useState(todayStr());
  const [outcome, setOutcome] = useState<OutcomeChoice>({ kind: 'vomit' });
  const [mode, setMode] = useState<PlotMode>('labels');
  const [labelCategory, setLabelCategory] = useState<LabelCategory>('ingredients');
  const [durationFactorId, setDurationFactorId] = useState<string>();
  const [bucket, setBucket] = useState<'day' | 'week'>('day');

  const settings = useLiveQuery(() => db.settings.get(SETTINGS_ID), []);
  const windowHours = settings?.associationWindowHours ?? 2;

  const vomits = useLiveQuery(() => db.vomits.where('deleted').equals(0).toArray(), []) ?? [];
  const gassiness = useLiveQuery(() => db.gassiness.where('deleted').equals(0).toArray(), []) ?? [];
  const stools = useLiveQuery(() => db.stools.where('deleted').equals(0).toArray(), []) ?? [];
  const meals = useLiveQuery(() => db.meals.where('deleted').equals(0).toArray(), []) ?? [];
  const ingredients = useLiveQuery(() => db.ingredients.where('deleted').equals(0).toArray(), []) ?? [];
  const catalog = useLiveQuery(() => db.foodCatalog.where('deleted').equals(0).toArray(), []) ?? [];
  const factors = useLiveQuery(() => db.factors.where('archived').equals(0).toArray(), []) ?? [];
  const factorEvents = useLiveQuery(() => db.factorEvents.where('deleted').equals(0).toArray(), []) ?? [];
  const savedViews = useLiveQuery(
    () => db.savedViews.where('deleted').equals(0).reverse().sortBy('updatedAt'),
    [],
  ) ?? [];

  // Plain derivations (not useMemo) below, matching this codebase's existing
  // convention for Dexie-derived arrays (see GrowthChart.tsx/NutritionDay.tsx)
  // — every source array here is already small (one baby's data), so
  // recomputing on each render is not a real perf concern, and it sidesteps
  // react-hooks/exhaustive-deps false positives on useLiveQuery-backed arrays.
  const scaleFactors = factors.filter((f) => f.kind === 'scale');
  const durationFactors = factors.filter((f) => f.kind === 'duration');

  const ingredientNameById = new Map<string, string>();
  for (const ing of ingredients) ingredientNameById.set(ing.id, ing.name);
  const labelDisplayName = (label: string) => ingredientNameById.get(label) ?? label;

  const catalogIngredientIds: Record<string, string[]> = {};
  for (const c of catalog) catalogIngredientIds[c.id] = c.ingredientIds;

  // ---- Outcome events for the chosen outcome kind, filtered to the date range ----
  let outcomeTimestamps: string[];
  if (outcome.kind === 'vomit') {
    outcomeTimestamps = vomits.map((v) => v.timestamp);
  } else if (outcome.kind === 'gas-more') {
    outcomeTimestamps = gassiness.filter((g) => g.level === 'more').map((g) => dateOnlyToLocalNoon(g.date));
  } else if (outcome.kind === 'stool-problem') {
    outcomeTimestamps = stools.filter((s) => isProblemStoolConsistency(s.consistency)).map((s) => s.timestamp);
  } else {
    const { factorId } = outcome;
    outcomeTimestamps = factorEvents
      .filter((e) => e.factorId === factorId && e.timestamp)
      .map((e) => e.timestamp as string);
  }
  const outcomeEvents = outcomeTimestamps
    .filter((t) => inDateRange(t, rangeStart, rangeEnd))
    .map((timestamp) => ({ timestamp }));

  // ---- mode: 'labels' — per-ingredient/texture rate table ----
  const mealsInRange = meals.filter((m) => inDateRange(m.timestamp, rangeStart, rangeEnd));
  const exposures = mealsToExposures(mealsInRange, catalogIngredientIds, labelCategory);
  const labelRates = computeLabelRates(exposures, outcomeEvents, windowHours)
    .slice()
    .sort((a, b) => b.rate - a.rate);
  const labelChartData = labelRates.slice(0, 12).map((r) => ({
    ...r,
    displayLabel: labelDisplayName(r.label),
  }));

  // ---- mode: 'duration' — inside/outside baseline for one duration Factor ----
  const durationFactorEvents = durationFactorId
    ? factorEvents.filter((e) => e.factorId === durationFactorId)
    : [];
  const baseline = durationFactorId
    ? computeDurationFactorBaseline(
      factorEventsToDurationIntervals(durationFactorEvents),
      outcomeEvents,
      `${rangeStart}T00:00:00`,
      `${rangeEnd}T23:59:59.999`,
    )
    : undefined;
  const baselineChartData = baseline ? [
    { name: 'Inside', rate: baseline.insideRate, count: baseline.insideCount, hours: baseline.insideHours },
    { name: 'Outside', rate: baseline.outsideRate, count: baseline.outsideCount, hours: baseline.outsideHours },
  ] : [];

  // ---- mode: 'timeseries' — outcome count per day/week bucket ----
  const buckets = bucketCounts(outcomeEvents.map((o) => o.timestamp), bucket);

  // ---- Saved views ----
  function currentConfig(): PlotConfig {
    return {
      rangeStart, rangeEnd, outcome, mode, labelCategory, durationFactorId, bucket,
    };
  }
  async function saveView() {
    const name = window.prompt('Name this view:')?.trim();
    if (!name) return;
    await db.savedViews.add({
      ...baseFields(), type: 'savedView', name, config: currentConfig(),
    });
  }
  function loadView(view: SavedView) {
    const c = view.config;
    setRangeStart(c.rangeStart);
    setRangeEnd(c.rangeEnd);
    setOutcome(c.outcome);
    setMode(c.mode);
    setLabelCategory(c.labelCategory);
    setDurationFactorId(c.durationFactorId);
    setBucket(c.bucket);
  }
  async function deleteView(view: SavedView) {
    if (!window.confirm(`Delete saved view "${view.name}"?`)) return;
    await db.savedViews.update(view.id, { deleted: 1, updatedAt: new Date().toISOString() });
  }

  const outcomeOptions = [
    { value: 'vomit' as OutcomeKey, label: 'Vomit' },
    { value: 'gas-more' as OutcomeKey, label: 'Gassiness (more)' },
    { value: 'stool-problem' as OutcomeKey, label: 'Stool (hard/loose/watery)' },
    ...scaleFactors.map((f) => ({ value: `factor:${f.id}` as OutcomeKey, label: f.name })),
  ];

  return (
    <>
      <div className="warn-banner">
        Descriptive, not diagnostic — this chart spots patterns to discuss with your pediatrician.
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <Field label="Start date">
          <input type="date" value={rangeStart} max={rangeEnd} onChange={(e) => setRangeStart(e.target.value)} />
        </Field>
        <Field label="End date">
          <input type="date" value={rangeEnd} max={todayStr()} onChange={(e) => setRangeEnd(e.target.value)} />
        </Field>
      </div>

      <Field label="Outcome (what to measure)">
        <ChipSelect
          value={outcomeToKey(outcome)}
          allowClear={false}
          onChange={(v) => v && setOutcome(keyToOutcome(v))}
          options={outcomeOptions}
        />
      </Field>

      <Field label="View">
        <ChipSelect
          value={mode}
          allowClear={false}
          onChange={(v) => v && setMode(v)}
          options={[
            { value: 'labels', label: 'Ingredient/texture rates' },
            { value: 'duration', label: 'Duration factor (pre/post)' },
            { value: 'timeseries', label: 'Frequency over time' },
          ]}
        />
      </Field>

      {mode === 'labels' && (
        <>
          <Field label="Compare by">
            <ChipSelect
              value={labelCategory}
              allowClear={false}
              onChange={(v) => v && setLabelCategory(v)}
              options={[
                { value: 'ingredients', label: 'Ingredients' },
                { value: 'textures', label: 'Textures' },
                { value: 'both', label: 'Both' },
              ]}
            />
          </Field>

          <div className="hint" style={{ margin: '2px 2px 12px' }}>
            Association window: {windowHours}h. An outcome counts toward a label if it happens within
            {' '}{windowHours}h after a meal carrying that label.
          </div>

          {labelRates.length === 0 ? (
            <div className="empty">No meals with this label category in the selected date range.</div>
          ) : (
            <>
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer>
                  <BarChart data={labelChartData} margin={{ top: 8, right: 12, bottom: 48, left: 0 }}>
                    <CartesianGrid stroke="var(--line-soft)" />
                    <XAxis
                      dataKey="displayLabel"
                      tick={{ fill: '#94A3B8', fontSize: 11 }}
                      axisLine={{ stroke: '#263349' }}
                      angle={-35}
                      textAnchor="end"
                      height={70}
                      interval={0}
                    />
                    <YAxis tick={{ fill: '#94A3B8' }} axisLine={{ stroke: '#263349' }} />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, color: 'var(--ink)',
                      }}
                      labelStyle={{ color: 'var(--ink)' }}
                      itemStyle={{ color: 'var(--ink)' }}
                      formatter={(value, _name, item) => {
                        const row = item.payload as typeof labelChartData[number];
                        return [`${row.outcomes} of ${row.exposures} exposures (${Math.round(Number(value) * 100)}%)`, 'Rate'];
                      }}
                    />
                    <Bar dataKey="rate" fill={ACCENT} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <table className="plot-table" style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14, fontSize: 13 }}>
                <thead>
                  <tr style={{ color: 'var(--ink-soft)', textAlign: 'left' }}>
                    <th style={{ padding: '4px 6px' }}>Label</th>
                    <th style={{ padding: '4px 6px' }}>Exposures</th>
                    <th style={{ padding: '4px 6px' }}>Outcomes</th>
                    <th style={{ padding: '4px 6px' }}>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {labelRates.map((r) => (
                    <tr key={r.label} style={{ borderTop: '1px solid var(--line-soft)', color: 'var(--ink)' }}>
                      <td style={{ padding: '6px' }}>{labelDisplayName(r.label)}</td>
                      <td style={{ padding: '6px' }}>{r.exposures}</td>
                      <td style={{ padding: '6px' }}>{r.outcomes}</td>
                      <td style={{ padding: '6px' }}>{r.rate.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}

      {mode === 'duration' && (
        <>
          {durationFactors.length === 0 ? (
            <div className="empty">No duration-kind Factors yet — add one (e.g. "Car ride") in Manage Factors.</div>
          ) : (
            <Field label="Duration factor">
              <ChipSelect
                value={durationFactorId}
                onChange={setDurationFactorId}
                options={durationFactors.map((f) => ({ value: f.id, label: f.name }))}
              />
            </Field>
          )}

          {!durationFactorId ? (
            <div className="empty">Pick a duration factor above to compare inside vs. outside its intervals.</div>
          ) : baseline && (baseline.insideCount + baseline.outsideCount) === 0 ? (
            <div className="empty">No outcome events in the selected date range.</div>
          ) : baseline && (
            <>
              <div style={{ width: '100%', height: 220 }}>
                <ResponsiveContainer>
                  <BarChart data={baselineChartData} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                    <CartesianGrid stroke="var(--line-soft)" />
                    <XAxis dataKey="name" tick={{ fill: '#94A3B8' }} axisLine={{ stroke: '#263349' }} />
                    <YAxis
                      tick={{ fill: '#94A3B8' }}
                      axisLine={{ stroke: '#263349' }}
                      label={{
                        value: 'events / hour', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#94A3B8',
                      }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, color: 'var(--ink)',
                      }}
                      labelStyle={{ color: 'var(--ink)' }}
                      itemStyle={{ color: 'var(--ink)' }}
                      formatter={(value, _name, item) => {
                        const row = item.payload as typeof baselineChartData[number];
                        return [`${row.count} events over ${row.hours.toFixed(1)}h (${Number(value).toFixed(3)}/hr)`, 'Rate'];
                      }}
                    />
                    <Bar dataKey="rate" radius={[4, 4, 0, 0]}>
                      {baselineChartData.map((d) => (
                        <Cell key={d.name} fill={d.name === 'Inside' ? ACCENT : CALM} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="hint" style={{ margin: '8px 2px 0' }}>
                Inside: {baseline.insideCount} outcome{baseline.insideCount === 1 ? '' : 's'} over {baseline.insideHours.toFixed(1)}h
                {' '}({baseline.insideRate.toFixed(3)}/hr). Outside: {baseline.outsideCount} outcome{baseline.outsideCount === 1 ? '' : 's'}
                {' '}over {baseline.outsideHours.toFixed(1)}h ({baseline.outsideRate.toFixed(3)}/hr).
              </div>
            </>
          )}
        </>
      )}

      {mode === 'timeseries' && (
        <>
          <Field label="Bucket by">
            <ChipSelect
              value={bucket}
              allowClear={false}
              onChange={(v) => v && setBucket(v)}
              options={[
                { value: 'day', label: 'Day' },
                { value: 'week', label: 'Week' },
              ]}
            />
          </Field>

          {buckets.length === 0 ? (
            <div className="empty">No outcome events in the selected date range.</div>
          ) : (
            <div style={{ width: '100%', height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={buckets} margin={{ top: 8, right: 12, bottom: 40, left: 0 }}>
                  <CartesianGrid stroke="var(--line-soft)" />
                  <XAxis
                    dataKey="bucket"
                    tick={{ fill: '#94A3B8', fontSize: 11 }}
                    axisLine={{ stroke: '#263349' }}
                    angle={-35}
                    textAnchor="end"
                    height={56}
                  />
                  <YAxis tick={{ fill: '#94A3B8' }} axisLine={{ stroke: '#263349' }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, color: 'var(--ink)',
                    }}
                    labelStyle={{ color: 'var(--ink)' }}
                    itemStyle={{ color: 'var(--ink)' }}
                  />
                  <Bar dataKey="count" fill={ACCENT} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}

      <div className="section-label">Saved views</div>
      <button type="button" className="btn ghost" onClick={saveView}>Save this view</button>
      {savedViews.length === 0 ? (
        <div className="hint" style={{ margin: '10px 2px 0' }}>No saved views yet.</div>
      ) : (
        savedViews.map((view) => (
          <div key={view.id} className="entry" onClick={() => loadView(view)} style={{ cursor: 'pointer' }}>
            <div className="body">
              <div className="title">{view.name}</div>
              <div className="meta">
                {view.config.rangeStart} → {view.config.rangeEnd} · {view.config.mode}
              </div>
            </div>
            <button
              type="button"
              className="btn ghost"
              style={{
                flex: 'none', width: 'auto', minHeight: 32, padding: '4px 10px', fontSize: 12,
                color: 'var(--alert)', borderColor: 'rgba(178,59,59,.32)',
              }}
              onClick={(e) => { e.stopPropagation(); void deleteView(view); }}
            >
              Delete
            </button>
          </div>
        ))
      )}
    </>
  );
}

export default PlotBuilder;
