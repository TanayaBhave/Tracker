import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';

type Row = {
  id: string; t: string; title: string; meta?: string; flag?: boolean; type: string;
  allDay?: boolean;
};

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

export function Timeline({
  dateStr,
  onSelect,
}: {
  dateStr: string;
  onSelect?: (id: string, type: string) => void;
}) {
  const rows = useLiveQuery(async () => {
    const dayStart = startOfDay(new Date(dateStr + 'T00:00')).toISOString();
    const dayEnd = new Date(new Date(dayStart).getTime() + 86400000).toISOString();
    const inDay = (iso?: string) => !!iso && iso >= dayStart && iso < dayEnd;
    // Daily records sort at the start of the day (bottom of the descending list).
    // Use the UTC ISO of local midnight so it compares correctly with event timestamps.
    const dayAnchor = dayStart;

    const out: Row[] = [];
    const [meals, vomits, stools, meds, sleep, weights, gas, activity, symptoms] = await Promise.all([
      db.meals.where('deleted').equals(0).toArray(),
      db.vomits.where('deleted').equals(0).toArray(),
      db.stools.where('deleted').equals(0).toArray(),
      db.meds.where('deleted').equals(0).toArray(),
      db.sleep.where('deleted').equals(0).toArray(),
      db.weights.where('deleted').equals(0).toArray(),
      db.gassiness.where('deleted').equals(0).toArray(),
      db.activity.where('deleted').equals(0).toArray(),
      db.symptoms.where('deleted').equals(0).toArray(),
    ]);
    for (const m of meals) if (inDay(m.timestamp)) out.push({
      id: m.id, t: m.timestamp, type: m.type,
      title: `🍽 ${m.foodItems[0]?.name ?? 'Meal'}`,
      meta: [m.texture, m.burped === 'no' ? 'no burp' : null, m.reaction !== 'none' ? m.reaction : null].filter(Boolean).join(' · ') || undefined,
      flag: m.reaction === 'vomited',
    });
    for (const v of vomits) if (inDay(v.timestamp)) out.push({
      id: v.id, t: v.timestamp, type: v.type,
      title: `🤢 Vomit · ${v.severity}`,
      meta: [v.forcefulness, v.appearance, v.bodyPosition].filter(Boolean).join(' · ') || undefined,
      flag: v.appearance === 'bile-green' || v.appearance === 'bloody-streak' || v.forcefulness === 'projectile',
    });
    for (const s of stools) if (inDay(s.timestamp)) out.push({
      id: s.id, t: s.timestamp, type: s.type,
      title: `💩 Nappy · ${s.consistency}`,
      meta: s.straining ? 'strained' : undefined,
    });
    for (const x of meds) if (inDay(x.timestamp)) out.push({
      id: x.id, t: x.timestamp, type: x.type,
      title: `💊 ${x.medName}`,
      meta: x.doseAmount ? `${x.doseAmount} ${x.doseUnit ?? ''}`.trim() : undefined,
    });
    for (const z of sleep) if (inDay(z.startTime)) out.push({
      id: z.id, t: z.startTime, type: z.type,
      title: `😴 Sleep`,
      meta: z.endTime ? `until ${fmtTime(z.endTime)}` : 'in progress',
    });
    for (const w of weights) if (w.date === dateStr) out.push({
      id: w.id, t: dayAnchor, type: w.type, allDay: true,
      title: `⚖️ Weight · ${w.weight} ${w.unit}`,
      meta: w.notes || undefined,
    });
    for (const g of gas) if (g.date === dateStr) out.push({
      id: g.id, t: dayAnchor, type: g.type, allDay: true,
      title: `🌀 Gassiness · ${g.level}`,
      meta: g.notes || undefined,
      flag: g.level === 'more',
    });
    for (const a of activity) if (a.date === dateStr) out.push({
      id: a.id, t: dayAnchor, type: a.type, allDay: true,
      title: `🤸 Activity · ${a.level}`,
      meta: a.notes || undefined,
    });
    for (const sy of symptoms) if (sy.date === dateStr) out.push({
      id: sy.id, t: dayAnchor, type: sy.type, allDay: true,
      title: `📋 Symptoms · ${sy.flags.length} flag${sy.flags.length === 1 ? '' : 's'}`,
      meta: sy.flags.join(' · ') || undefined,
      flag: sy.flags.includes('fever') || sy.flags.includes('fewer-wet-diapers'),
    });
    out.sort((a, b) => b.t.localeCompare(a.t));
    return out;
  }, [dateStr]);

  if (!rows) return null;
  if (rows.length === 0) return <div className="empty">No entries yet today.<br />Tap a button above to log the first one.</div>;

  return (
    <div className="timeline">
      {rows.map((r) => (
        <div
          className="entry"
          key={r.id}
          role={onSelect ? 'button' : undefined}
          tabIndex={onSelect ? 0 : undefined}
          style={onSelect ? { cursor: 'pointer' } : undefined}
          onClick={() => onSelect?.(r.id, r.type)}
          onKeyDown={(e) => e.key === 'Enter' && onSelect?.(r.id, r.type)}
        >
          <div className="time">{r.allDay ? 'day' : fmtTime(r.t)}</div>
          <div className="body">
            <div className="title">{r.title} {r.flag && <span className="tag">• flag</span>}</div>
            {r.meta && <div className="meta">{r.meta}</div>}
          </div>
          {onSelect && <div style={{ color: 'var(--ink-soft)', fontSize: 18, alignSelf: 'center' }}>›</div>}
        </div>
      ))}
    </div>
  );
}
