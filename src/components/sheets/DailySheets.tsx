import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, baseFields, todayStr } from '../../db';
import type { GassinessLog, PhysicalActivityLog, ThreeLevel } from '../../db';
import { Sheet } from '../Sheet';
import { Field, ChipSelect } from '../Fields';

type Props = { onClose: () => void; editId?: string };

// ---------- DAILY: gassiness + activity (three-level) ----------
function ThreeLevelSheet({ onClose, editId, kind }: Props & { kind: 'gas' | 'activity' }) {
  const [date, setDate] = useState(todayStr());
  const [level, setLevel] = useState<ThreeLevel>('regular');
  const [notes, setNotes] = useState('');
  const noun = kind === 'gas' ? 'Gassiness' : 'Activity';

  const existing = useLiveQuery(
    async (): Promise<GassinessLog | PhysicalActivityLog | undefined> => {
      if (!editId) return undefined;
      return kind === 'gas' ? db.gassiness.get(editId) : db.activity.get(editId);
    },
    [editId, kind],
  );

  useEffect(() => {
    if (!existing) return;
    setDate(existing.date);
    setLevel(existing.level);
    setNotes(existing.notes ?? '');
  }, [existing]);

  async function save() {
    const fields = {
      date, level, notes: notes || undefined,
      updatedAt: new Date().toISOString(),
    };
    if (kind === 'gas') {
      if (editId && existing) await db.gassiness.put({ ...(existing as GassinessLog), ...fields });
      else await db.gassiness.add({ ...baseFields(), type: 'gas', ...fields });
    } else {
      if (editId && existing) await db.activity.put({ ...(existing as PhysicalActivityLog), ...fields });
      else await db.activity.add({ ...baseFields(), type: 'activity', ...fields });
    }
    onClose();
  }

  async function handleDelete() {
    if (!editId || !window.confirm(`Delete this ${noun.toLowerCase()} entry?`)) return;
    const tombstone = { deleted: 1 as const, updatedAt: new Date().toISOString() };
    if (kind === 'gas') await db.gassiness.update(editId, tombstone);
    else await db.activity.update(editId, tombstone);
    onClose();
  }

  return (
    <Sheet
      title={editId ? `Edit ${noun.toLowerCase()}` : `${noun} today`}
      onClose={onClose} onSave={save}
      onDelete={editId ? handleDelete : undefined}
    >
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
export const GasSheet = (p: Props) => <ThreeLevelSheet {...p} kind="gas" />;
export const ActivitySheet = (p: Props) => <ThreeLevelSheet {...p} kind="activity" />;
