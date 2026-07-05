import { useState } from 'react';
import { db, baseFields, todayStr } from '../../db';
import type { ThreeLevel } from '../../db';
import { Sheet } from '../Sheet';
import { Field, ChipSelect } from '../Fields';

// ---------- DAILY: gassiness + activity (three-level) ----------
function ThreeLevelSheet({ onClose, kind }: { onClose: () => void; kind: 'gas' | 'activity' }) {
  const [date, setDate] = useState(todayStr());
  const [level, setLevel] = useState<ThreeLevel>('regular');
  const [notes, setNotes] = useState('');
  const title = kind === 'gas' ? 'Gassiness today' : 'Activity today';
  async function save() {
    const base = { ...baseFields(), date, level, notes: notes || undefined };
    if (kind === 'gas') await db.gassiness.add({ ...base, type: 'gas' });
    else await db.activity.add({ ...base, type: 'activity' });
    onClose();
  }
  return (
    <Sheet title={title} onClose={onClose} onSave={save}>
      <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Level">
        <ChipSelect value={level} allowClear={false} onChange={(v) => v && setLevel(v)} options={[
          { value: 'less', label: 'Less', tone: 'calm' }, { value: 'regular', label: 'Regular' }, { value: 'more', label: 'More', tone: 'alert' },
        ]} />
      </Field>
      <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Sheet>
  );
}
export const GasSheet = (p: { onClose: () => void }) => <ThreeLevelSheet {...p} kind="gas" />;
export const ActivitySheet = (p: { onClose: () => void }) => <ThreeLevelSheet {...p} kind="activity" />;
