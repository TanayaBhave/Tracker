import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  db, baseFields, nowLocalISO, nowLocalISOOnDate, isoToLocal,
} from '../../db';
import type { StoolConsistency } from '../../db';
import { Sheet } from '../Sheet';
import { Field, ChipSelect } from '../Fields';

type Props = { onClose: () => void; editId?: string; defaultDate?: string };
const toISO = (local: string) => new Date(local).toISOString();

export function StoolSheet({ onClose, editId, defaultDate }: Props) {
  const [when, setWhen] = useState(defaultDate ? nowLocalISOOnDate(defaultDate) : nowLocalISO());
  const [consistency, setConsistency] = useState<StoolConsistency>('soft');
  const [straining, setStraining] = useState(false);
  const [notes, setNotes] = useState('');

  const existing = useLiveQuery(() => editId ? db.stools.get(editId) : undefined, [editId]);

  useEffect(() => {
    if (!existing) return;
    setWhen(isoToLocal(existing.timestamp));
    setConsistency(existing.consistency);
    setStraining(existing.straining === 1);
    setNotes(existing.notes ?? '');
  }, [existing]);

  async function save() {
    const fields = {
      timestamp: toISO(when),
      consistency, straining: straining ? 1 as const : 0 as const,
      notes: notes || undefined,
      updatedAt: new Date().toISOString(),
    };
    if (editId && existing) {
      await db.stools.put({ ...existing, ...fields });
    } else {
      await db.stools.add({ ...baseFields(), type: 'stool', ...fields });
    }
    onClose();
  }

  async function handleDelete() {
    if (!editId || !window.confirm('Delete this nappy entry?')) return;
    await db.stools.update(editId, { deleted: 1, updatedAt: new Date().toISOString() });
    onClose();
  }

  return (
    <Sheet
      title={editId ? 'Edit nappy' : 'Log nappy / stool'}
      onClose={onClose} onSave={save}
      onDelete={editId ? handleDelete : undefined}
    >
      <Field label="Time"><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
      <Field label="Consistency">
        <ChipSelect value={consistency} allowClear={false} onChange={(v) => v && setConsistency(v)} options={[
          { value: 'hard', label: 'Hard' }, { value: 'formed', label: 'Formed' },
          { value: 'soft', label: 'Soft', tone: 'calm' }, { value: 'loose', label: 'Loose' },
          { value: 'watery', label: 'Watery' },
        ]} />
      </Field>
      <Field label="Straining?">
        <ChipSelect value={straining ? 'y' : undefined} onChange={(v) => setStraining(v === 'y')} options={[{ value: 'y', label: 'Strained', tone: 'alert' }]} />
      </Field>
      <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Sheet>
  );
}
