import { useState } from 'react';
import { db, baseFields, todayStr } from '../../db';
import { Sheet } from '../Sheet';
import { Field, ChipSelect } from '../Fields';

export function WeightSheet({ onClose }: { onClose: () => void }) {
  const [date, setDate] = useState(todayStr());
  const [weight, setWeight] = useState('');
  const [unit, setUnit] = useState<'kg' | 'lb'>('kg');
  const [notes, setNotes] = useState('');
  async function save() {
    if (!weight) return onClose();
    await db.weights.add({
      ...baseFields(), type: 'weight', date, weight: Number(weight), unit, notes: notes || undefined,
    });
    onClose();
  }
  return (
    <Sheet title="Log weight" onClose={onClose} onSave={save}>
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
