import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, baseFields, nowLocalISO, isoToLocal } from '../../db';
import { Sheet } from '../Sheet';
import { Field } from '../Fields';

type Props = { onClose: () => void; editId?: string };
const toISO = (local: string) => new Date(local).toISOString();

export function MedSheet({ onClose, editId }: Props) {
  const [when, setWhen] = useState(nowLocalISO());
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('ml');
  const [notes, setNotes] = useState('');

  const existing = useLiveQuery(() => editId ? db.meds.get(editId) : undefined, [editId]);

  useEffect(() => {
    if (!existing) return;
    setWhen(isoToLocal(existing.timestamp));
    setName(existing.medName);
    setAmount(existing.doseAmount?.toString() ?? '');
    setUnit(existing.doseUnit ?? 'ml');
    setNotes(existing.notes ?? '');
  }, [existing]);

  async function save() {
    const fields = {
      timestamp: toISO(when),
      medName: name.trim() || 'Medication',
      doseAmount: amount ? Number(amount) : undefined,
      doseUnit: unit,
      notes: notes || undefined,
      updatedAt: new Date().toISOString(),
    };
    if (editId && existing) {
      await db.meds.put({ ...existing, ...fields });
    } else {
      await db.meds.add({ ...baseFields(), type: 'med', ...fields });
    }
    onClose();
  }

  async function handleDelete() {
    if (!editId || !window.confirm('Delete this medication entry?')) return;
    await db.meds.update(editId, { deleted: 1, updatedAt: new Date().toISOString() });
    onClose();
  }

  return (
    <Sheet
      title={editId ? 'Edit medication' : 'Log medication'}
      onClose={onClose} onSave={save}
      onDelete={editId ? handleDelete : undefined}
    >
      <Field label="Time"><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
      <Field label="Medication"><input type="text" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div style={{ display: 'flex', gap: 10 }}>
        <Field label="Dose"><input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Unit"><input type="text" value={unit} onChange={(e) => setUnit(e.target.value)} /></Field>
      </div>
      <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Sheet>
  );
}
