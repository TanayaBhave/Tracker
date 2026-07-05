import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, baseFields, todayStr } from '../../db';
import { Sheet } from '../Sheet';
import { Field, ChipSelect } from '../Fields';

type Props = { onClose: () => void; editId?: string };

export function WeightSheet({ onClose, editId }: Props) {
  const [date, setDate] = useState(todayStr());
  const [weight, setWeight] = useState('');
  const [unit, setUnit] = useState<'kg' | 'lb'>('kg');
  const [notes, setNotes] = useState('');

  const existing = useLiveQuery(() => editId ? db.weights.get(editId) : undefined, [editId]);

  useEffect(() => {
    if (!existing) return;
    setDate(existing.date);
    setWeight(existing.weight.toString());
    setUnit(existing.unit);
    setNotes(existing.notes ?? '');
  }, [existing]);

  async function save() {
    if (!weight) return onClose();
    const fields = {
      date, weight: Number(weight), unit, notes: notes || undefined,
      updatedAt: new Date().toISOString(),
    };
    if (editId && existing) {
      await db.weights.put({ ...existing, ...fields });
    } else {
      await db.weights.add({ ...baseFields(), type: 'weight', ...fields });
    }
    onClose();
  }

  async function handleDelete() {
    if (!editId || !window.confirm('Delete this weight entry?')) return;
    await db.weights.update(editId, { deleted: 1, updatedAt: new Date().toISOString() });
    onClose();
  }

  return (
    <Sheet
      title={editId ? 'Edit weight' : 'Log weight'}
      onClose={onClose} onSave={save}
      onDelete={editId ? handleDelete : undefined}
    >
      <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <div style={{ display: 'flex', gap: 10 }}>
        <Field label="Weight"><input type="number" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} /></Field>
        <Field label="Unit">
          <ChipSelect value={unit} allowClear={false} onChange={(v) => v && setUnit(v)} options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]} />
        </Field>
      </div>
      <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Sheet>
  );
}
