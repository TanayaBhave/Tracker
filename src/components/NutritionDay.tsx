// Daily nutrition view: macro-kcal pie + micronutrient %-of-DRI bars.
// Implemented by workstream W4 (Phase 3). See src/nutrition/{intake,dri}.ts.
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from 'recharts';
import { db, SETTINGS_ID, todayStr } from '../db';
import type { NutrientProfile } from '../db';
import { computeDailyIntake } from '../nutrition/intake';
import { driForSettings } from '../nutrition/dri';

// Macro pie colors — kept in sync with index.css's --ev-sleep/--ev-gas/--ev-symptom
// tokens (can't reference CSS custom properties directly on SVG fill across all
// target browsers, so the hex is duplicated here). Validated as a CVD-safe
// categorical trio via the dataviz skill's palette checker (all 4 checks pass
// against this app's --paper surface).
const MACRO_COLORS = { protein: '#3b7dc4', carbs: '#a98b3d', fat: '#b0538f' } as const;

const MICRO_ROWS: { key: keyof NutrientProfile; label: string; unit: string; decimals: number }[] = [
  { key: 'fiber_g', label: 'Fiber', unit: 'g', decimals: 1 },
  { key: 'iron_mg', label: 'Iron', unit: 'mg', decimals: 1 },
  { key: 'calcium_mg', label: 'Calcium', unit: 'mg', decimals: 0 },
  { key: 'zinc_mg', label: 'Zinc', unit: 'mg', decimals: 1 },
  { key: 'vitD_ug', label: 'Vitamin D', unit: 'µg', decimals: 1 },
  { key: 'vitC_mg', label: 'Vitamin C', unit: 'mg', decimals: 0 },
  { key: 'vitA_ug_rae', label: 'Vitamin A', unit: 'µg RAE', decimals: 0 },
  { key: 'potassium_mg', label: 'Potassium', unit: 'mg', decimals: 0 },
  { key: 'sodium_mg', label: 'Sodium', unit: 'mg', decimals: 0 },
  { key: 'folate_ug', label: 'Folate', unit: 'µg', decimals: 0 },
  { key: 'vitB12_ug', label: 'Vitamin B12', unit: 'µg', decimals: 1 },
];

// Sugar rows (Phase 3.6) are rendered separately from MICRO_ROWS above: there
// is no DRI for either sugar_g or addedSugar_g (see src/nutrition/dri.ts), so
// these always pass target={undefined} into MicroRow, taking its existing
// no-target path (raw amount only, no %DRI bar) rather than inventing one.
const SUGAR_ROWS: { key: keyof NutrientProfile; label: string; unit: string; decimals: number }[] = [
  { key: 'sugar_g', label: 'Sugar (total)', unit: 'g', decimals: 1 },
  { key: 'addedSugar_g', label: 'Added sugar', unit: 'g', decimals: 1 },
];

// %DRI meter: fill capped at 150% of target, with a tick at the 100% mark and
// an overflow label past the cap. Raw amount + target + percent are always
// shown as text, never encoded only in bar length.
function MicroRow({
  label, unit, decimals, amount, target,
}: {
  label: string; unit: string; decimals: number; amount: number; target: number | undefined;
}) {
  const pct = target ? (amount / target) * 100 : undefined;
  const capped = pct !== undefined ? Math.min(pct, 150) : 0;
  const overflow = pct !== undefined && pct > 150;

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, marginBottom: 4 }}>
        <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{label}</span>
        <span style={{ color: 'var(--ink-soft)', textAlign: 'right' }}>
          {amount.toFixed(decimals)}{unit}
          {target !== undefined && ` / ${target}${unit}`}
          {pct !== undefined && ` · ${Math.round(pct)}%`}
        </span>
      </div>
      {target !== undefined && (
        <div style={{
          position: 'relative', height: 10, borderRadius: 999, background: 'var(--chip-idle)', overflow: 'hidden',
        }}
        >
          <div style={{
            position: 'absolute', left: `${(100 / 150) * 100}%`, top: 0, bottom: 0, width: 1, background: 'var(--ink-soft)',
          }}
          />
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(capped / 150) * 100}%`,
            background: 'var(--accent)', borderRadius: 999,
          }}
          />
          {overflow && (
            <span style={{
              position: 'absolute', right: 3, top: -1, fontSize: 9, fontWeight: 700, color: '#fff', lineHeight: '10px',
            }}
            >
              150%+
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function NutritionDay() {
  const [date, setDate] = useState(todayStr());
  const settings = useLiveQuery(() => db.settings.get(SETTINGS_ID), []);
  const intake = useLiveQuery(() => computeDailyIntake(date), [date]);

  const dri = useMemo(
    () => driForSettings(settings?.dob, date),
    [settings?.dob, date],
  );

  if (!intake) return null; // useLiveQuery hasn't resolved its first result yet

  const proteinKcal = (intake.protein_g ?? 0) * 4;
  const carbsKcal = (intake.carbs_g ?? 0) * 4;
  const fatKcal = (intake.fat_g ?? 0) * 9;
  const totalMacroKcal = proteinKcal + carbsKcal + fatKcal;
  const pieData = [
    { name: 'Protein', kcal: proteinKcal, grams: intake.protein_g ?? 0, color: MACRO_COLORS.protein },
    { name: 'Carbs', kcal: carbsKcal, grams: intake.carbs_g ?? 0, color: MACRO_COLORS.carbs },
    { name: 'Fat', kcal: fatKcal, grams: intake.fat_g ?? 0, color: MACRO_COLORS.fat },
  ];
  const hasMacros = totalMacroKcal > 0;

  return (
    <>
      <div className="field" style={{ marginTop: 8 }}>
        <label>Pick a day</label>
        <input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} />
      </div>

      {!settings?.dob && (
        <div className="hint" style={{ margin: '0 2px 14px' }}>
          Set your baby's date of birth in Settings to compare intake against age-appropriate DRI targets.
        </div>
      )}

      <div style={{ textAlign: 'center', margin: '4px 0 18px' }}>
        <div style={{ fontSize: 30, fontWeight: 700, color: 'var(--ink)' }}>
          {Math.round(intake.kcal ?? 0)} kcal
        </div>
        <div style={{ color: 'var(--ink-soft)', fontSize: 13, marginTop: 2 }}>
          {dri ? `${dri.label} bracket (chronological age) · ` : ''}{intake.coverage}
          {intake.supplementDoses > 0
            && ` · incl. ${intake.supplementDoses} supplement dose${intake.supplementDoses === 1 ? '' : 's'}`}
        </div>
      </div>

      {intake.itemsTotal === 0 ? (
        <div className="empty">No meals logged for this day yet.</div>
      ) : (
        <>
          {hasMacros && (
            <>
              <div style={{ position: 'relative', width: '100%', maxWidth: 220, margin: '0 auto' }}>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="kcal"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={2}
                      stroke="var(--paper)"
                      strokeWidth={2}
                    >
                      {pieData.map((d) => <Cell key={d.name} fill={d.color} />)}
                    </Pie>
                    <Tooltip
                      formatter={(value, name) => `${Math.round(Number(value))} kcal (${name})`}
                      contentStyle={{ borderRadius: 12, border: '1px solid var(--line)', fontSize: 13 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
                }}
                >
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>{Math.round(totalMacroKcal)}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>macro kcal</div>
                </div>
              </div>

              <div className="choices" style={{ justifyContent: 'center', marginBottom: 24 }}>
                {pieData.map((d) => (
                  <span key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-soft)' }}>
                    <span style={{
                      width: 10, height: 10, borderRadius: '50%', background: d.color, display: 'inline-block',
                    }}
                    />
                    {d.name} {d.grams.toFixed(1)}g
                  </span>
                ))}
              </div>
            </>
          )}

          <div className="section-label">Micronutrients{dri ? ` vs ${dri.label} DRI` : ''}</div>
          {MICRO_ROWS.map((row) => (
            <MicroRow
              key={row.key}
              label={row.label}
              unit={row.unit}
              decimals={row.decimals}
              amount={intake[row.key] ?? 0}
              target={dri?.targets[row.key]}
            />
          ))}

          <div className="section-label">Sugar</div>
          {SUGAR_ROWS.map((row) => (
            <MicroRow
              key={row.key}
              label={row.label}
              unit={row.unit}
              decimals={row.decimals}
              amount={intake[row.key] ?? 0}
              target={dri?.targets[row.key]}
            />
          ))}
          <div className="hint" style={{ margin: '-6px 2px 0' }}>
            AAP recommends no added sugar before age 2 — descriptive, not diagnostic.
          </div>
        </>
      )}

      <div className="warn-banner" style={{ marginTop: 18 }}>
        Pattern-spotting, not medical advice — bring anything notable to your pediatrician.
      </div>
    </>
  );
}
