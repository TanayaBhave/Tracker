// Growth charts: WHO weight-for-age — corrected age (live, primary/default) and
// chronological age (secondary tab) — plus the Fenton 2013 preterm chart
// (historical view of early weights, PMA <= 50 weeks).
// Implemented by workstream W5 (Phase 3/3.5). Reads Dexie `weights` + `settings`
// directly — no props.
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from 'recharts';
import { db, SETTINGS_ID } from '../db';
import { chronologicalAgeMonths, correctedAgeMonths, postmenstrualAgeWeeks } from '../growth/age';
import { percentileFromZ, valueFromZ, zFromValue } from '../growth/lms';
import { whoWfaBoys, whoWfaBoysAt } from '../growth/whoWfaBoys';
import { fentonBoys } from '../growth/fentonBoys';

const LB_TO_KG = 0.45359237;

function toKg(weight: number, unit: 'kg' | 'lb'): number {
  return unit === 'lb' ? weight * LB_TO_KG : weight;
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

// z-scores for the 5 percentile lines drawn on the WHO chart.
const WHO_PERCENTILE_LINES: { key: string; label: string; z: number }[] = [
  { key: 'p3', label: 'P3', z: -1.881 },
  { key: 'p15', label: 'P15', z: -1.036 },
  { key: 'p50', label: 'P50', z: 0 },
  { key: 'p85', label: 'P85', z: 1.036 },
  { key: 'p97', label: 'P97', z: 1.881 },
];

const WHO_LINE_COLOR: Record<string, string> = {
  p3: '#c9beA6', p15: '#a9bf8f', p50: '#295b7a', p85: '#a9bf8f', p97: '#c9beA6',
};
const FENTON_LINE_COLOR: Record<string, string> = {
  p3: '#c9beA6', p10: '#a9bf8f', p50: '#295b7a', p90: '#a9bf8f', p97: '#c9beA6',
};

function daysSince(dateStr: string, todayStr: string): number {
  const a = new Date(`${dateStr}T00:00:00Z`).getTime();
  const b = new Date(`${todayStr}T00:00:00Z`).getTime();
  return (b - a) / 86_400_000;
}

// The WHO weight-for-age curve/axes/tooltip are identical whether the age
// axis is corrected or chronological — only the age used to place points
// (and the words describing that age) differ. Shared here so the two tabs
// render the same ComposedChart rather than two near-duplicate copies.
function WhoChart({
  curve, scatter, ageLabel,
}: {
  curve: Record<string, number>[];
  scatter: { month: number; weightKg: number }[];
  ageLabel: 'corrected' | 'chronological';
}) {
  const axisWord = ageLabel === 'corrected' ? 'Corrected' : 'Chronological';
  return (
    <ResponsiveContainer>
      <ComposedChart data={curve} margin={{ top: 8, right: 12, bottom: 32, left: 0 }}>
        <CartesianGrid stroke="var(--line-soft)" />
        <XAxis
          dataKey="month" type="number" domain={[0, 24]}
          ticks={[0, 3, 6, 9, 12, 15, 18, 21, 24]}
          label={{ value: `${axisWord} age (months)`, position: 'bottom', offset: 12, fontSize: 12 }}
          tick={{ fontSize: 11 }}
        />
        <YAxis
          type="number" domain={['auto', 'auto']}
          label={{ value: 'Weight (kg)', angle: -90, position: 'insideLeft', fontSize: 12 }}
          tick={{ fontSize: 11 }}
        />
        <Tooltip
          formatter={(v) => `${Number(v).toFixed(2)} kg`}
          labelFormatter={(m) => `${Number(m).toFixed(1)} mo ${ageLabel}`}
        />
        <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 11 }} />
        {WHO_PERCENTILE_LINES.map(({ key, label }) => (
          <Line
            key={key} type="monotone" dataKey={key} name={label}
            stroke={WHO_LINE_COLOR[key]} strokeWidth={key === 'p50' ? 2.5 : 1.5}
            strokeDasharray={key === 'p50' ? undefined : '4 3'}
            dot={false} isAnimationActive={false}
          />
        ))}
        {scatter.length > 0 && (
          <Scatter data={scatter} dataKey="weightKg" name="Logged weight" fill="var(--ev-weight)" />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function GrowthChart() {
  const [view, setView] = useState<'who-corrected' | 'who-chronological' | 'fenton'>('who-corrected');

  const settings = useLiveQuery(() => db.settings.get(SETTINGS_ID), []);
  const weights = useLiveQuery(
    () => db.weights.where('deleted').equals(0).sortBy('date'),
    [],
    [], // default before the query resolves — distinct from "no settings row yet" below
  );

  // Note: `settings` is `undefined` both while the query is still resolving and when no
  // settings row exists yet; either way the right thing to show is the same prompt below,
  // so we don't need a separate "loading" branch.
  if (!settings?.dob || settings.gestWeeksAtBirth === undefined) {
    return (
      <div className="empty">
        Set the baby's date of birth and gestation in Settings to see the growth chart.
      </div>
    );
  }
  if (weights.length === 0) {
    return (
      <div className="empty">
        Log your first weight to see the growth chart here.
      </div>
    );
  }

  const dob = settings.dob;
  const gestWeeks = settings.gestWeeksAtBirth;
  const gestDays = settings.gestDaysAtBirth ?? 0;
  const today = new Date().toISOString().slice(0, 10);

  // Which age convention drives the WHO tab currently on screen. The Fenton
  // tab has no age-mode toggle of its own, so it (like the default WHO tab)
  // keeps the original corrected-age header — unchanged behavior.
  const ageMode: 'corrected' | 'chronological' = view === 'who-chronological' ? 'chronological' : 'corrected';
  const whoAgeAt = (dateStr: string) => (ageMode === 'chronological'
    ? chronologicalAgeMonths(dob, dateStr)
    : correctedAgeMonths(dob, gestWeeks, gestDays, dateStr));

  // Most recent logged weight, by date — drives the header stat.
  const latest = weights[weights.length - 1];
  const latestKg = toKg(latest.weight, latest.unit);
  const latestAge = whoAgeAt(latest.date);
  const { L: latestL, M: latestM, S: latestS } = whoWfaBoysAt(latestAge);
  const latestZ = zFromValue(latestKg, latestL, latestM, latestS);
  const latestPercentile = Math.round(percentileFromZ(latestZ));

  const overdue = daysSince(latest.date, today) > 14;

  // ---- WHO chart data: percentile curves (0-24 months) + logged weights ----
  // The curve itself (WHO LMS table, keyed by "months of age") is identical
  // for both the corrected and chronological tabs; only which age each logged
  // weight is plotted at (whoAgeAt above) changes between them.
  const whoCurve = whoWfaBoys.map(({ month, L, M, S }) => {
    const row: Record<string, number> = { month };
    for (const { key, z } of WHO_PERCENTILE_LINES) row[key] = valueFromZ(z, L, M, S);
    return row;
  });
  const whoScatter = weights
    .map((w) => ({
      month: whoAgeAt(w.date),
      weightKg: toKg(w.weight, w.unit),
    }))
    .filter((p) => p.month >= 0 && p.month <= 24);

  // ---- Fenton chart data: static percentile table + early weights (PMA <= 50 wk) ----
  const fentonScatter = weights
    .map((w) => ({
      pmaWeeks: postmenstrualAgeWeeks(dob, gestWeeks, gestDays, w.date),
      weightKg: toKg(w.weight, w.unit),
    }))
    .filter((p) => p.pmaWeeks <= 50);

  return (
    <>
      <div className="choices" style={{ marginTop: 8 }}>
        <button type="button" className={`chip ${view === 'who-corrected' ? 'on' : ''}`} onClick={() => setView('who-corrected')}>
          WHO (corrected)
        </button>
        <button type="button" className={`chip ${view === 'who-chronological' ? 'on' : ''}`} onClick={() => setView('who-chronological')}>
          WHO (chronological)
        </button>
        <button type="button" className={`chip ${view === 'fenton' ? 'on' : ''}`} onClick={() => setView('fenton')}>
          Fenton (22–50 wk PMA)
        </button>
      </div>

      <div className="entry" style={{ padding: '11px 4px' }}>
        <div className="body">
          <div className="title">
            {latestKg.toFixed(1)} kg — {ordinal(latestPercentile)} percentile (z {latestZ >= 0 ? '+' : ''}{latestZ.toFixed(2)}) at {latestAge.toFixed(1)} mo {ageMode}
          </div>
          <div className="meta">Based on the most recent weigh-in, logged {latest.date}.</div>
        </div>
      </div>

      {overdue && (
        <div className="warn-banner">
          It's been over 2 weeks since the last weigh-in — log a new weight when you can.
        </div>
      )}

      {view === 'who-chronological' && (
        <div className="hint">
          Preterm babies typically track lower on this curve against chronological age than against corrected age — descriptive, not diagnostic.
        </div>
      )}

      <div style={{ width: '100%', height: 360, marginTop: 8 }}>
        {view === 'who-corrected' || view === 'who-chronological' ? (
          <WhoChart curve={whoCurve} scatter={whoScatter} ageLabel={ageMode} />
        ) : (
          <ResponsiveContainer>
            <ComposedChart data={fentonBoys} margin={{ top: 8, right: 12, bottom: 32, left: 0 }}>
              <CartesianGrid stroke="var(--line-soft)" />
              <XAxis
                dataKey="pmaWeeks" type="number" domain={[22, 50]}
                ticks={[22, 26, 30, 34, 38, 42, 46, 50]}
                label={{ value: 'Postmenstrual age (weeks)', position: 'bottom', offset: 12, fontSize: 12 }}
                tick={{ fontSize: 11 }}
              />
              <YAxis
                type="number" domain={['auto', 'auto']}
                label={{ value: 'Weight (kg)', angle: -90, position: 'insideLeft', fontSize: 12 }}
                tick={{ fontSize: 11 }}
              />
              <Tooltip formatter={(v) => `${Number(v).toFixed(2)} kg`} labelFormatter={(w) => `${Number(w).toFixed(1)} wk PMA`} />
              <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="p3" name="P3" stroke={FENTON_LINE_COLOR.p3} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="p10" name="P10" stroke={FENTON_LINE_COLOR.p10} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="p50" name="P50" stroke={FENTON_LINE_COLOR.p50} strokeWidth={2.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="p90" name="P90" stroke={FENTON_LINE_COLOR.p90} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="p97" name="P97" stroke={FENTON_LINE_COLOR.p97} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              {fentonScatter.length > 0 && (
                <Scatter data={fentonScatter} dataKey="weightKg" name="Logged weight" fill="var(--ev-weight)" />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="hint">
        Descriptive, not diagnostic — this chart spots patterns to discuss with your pediatrician.
      </div>
    </>
  );
}
