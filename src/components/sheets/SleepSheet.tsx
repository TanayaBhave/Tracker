import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, baseFields, nowLocalISO, isoToLocal } from '../../db';
import { Sheet } from '../Sheet';
import { Field, ChipSelect } from '../Fields';

type Props = { onClose: () => void; editId?: string };
const toISO = (local: string) => new Date(local).toISOString();

export function SleepSheet({ onClose, editId }: Props) {
  const [start, setStart] = useState(nowLocalISO());
  const [end, setEnd] = useState('');
  const [quality, setQuality] = useState<'good' | 'restless' | 'poor'>();
  const [notes, setNotes] = useState('');

  const existing = useLiveQuery(() => editId ? db.sleep.get(editId) : undefined, [editId]);

  useEffect(() => {
    if (!existing) return;
    setStart(isoToLocal(existing.startTime));
    setEnd(existing.endTime ? isoToLocal(existing.endTime) : '');
    setQuality(existing.quality);
    setNotes(existing.notes ?? '');
  }, [existing]);

  async function save() {
    const fields = {
      startTime: toISO(start),
      endTime: end ? toISO(end) : undefined,
      quality,
      notes: notes || undefined,
      updatedAt: new Date().toISOString(),
    };
    if (editId && existing) {
      await db.sleep.put({ ...existing, ...fields });
    } else {
      await db.sleep.add({ ...baseFields(), type: 'sleep', ...fields });
    }
    onClose();
  }

  async function handleDelete() {
    if (!editId || !window.confirm('Delete this sleep entry?')) return;
    await db.sleep.update(editId, { deleted: 1, updatedAt: new Date().toISOString() });
    onClose();
  }

  return (
    <Sheet
      title={editId ? 'Edit sleep' : 'Log sleep'}
      onClose={onClose} onSave={save}
      onDelete={editId ? handleDelete : undefined}
    >
      <Field label="Start"><input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
      <Field label="End" hint="Leave blank if still sleeping."><input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      <Field label="Quality">
        <ChipSelect value={quality} onChange={setQuality} options={[
          { value: 'good', label: 'Good', tone: 'calm' }, { value: 'restless', label: 'Restless' }, { value: 'poor', label: 'Poor', tone: 'alert' },
        ]} />
      </Field>
      <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Sheet>
  );
}
