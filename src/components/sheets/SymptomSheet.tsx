import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, baseFields, todayStr } from '../../db';
import { Sheet } from '../Sheet';
import { Field, ChipMulti } from '../Fields';

// ---------- SYMPTOMS (daily flags) ----------
const SYMPTOM_OPTS = [
  { value: 'back-arching', label: 'Back-arching' }, { value: 'hoarse-cry', label: 'Hoarse cry' },
  { value: 'congestion', label: 'Congestion' }, { value: 'food-refusal', label: 'Food refusal' },
  { value: 'drooling-teething', label: 'Teething' }, { value: 'fever', label: 'Fever', tone: 'alert' as const },
  { value: 'fewer-wet-diapers', label: 'Fewer wet nappies', tone: 'alert' as const },
];

type Props = { onClose: () => void; editId?: string; defaultDate?: string };

export function SymptomSheet({ onClose, editId, defaultDate }: Props) {
  const [date, setDate] = useState(defaultDate ?? todayStr());
  const [flags, setFlags] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const redFlag = flags.includes('fever') || flags.includes('fewer-wet-diapers');

  const existing = useLiveQuery(() => editId ? db.symptoms.get(editId) : undefined, [editId]);

  useEffect(() => {
    if (!existing) return;
    setDate(existing.date);
    setFlags(existing.flags);
    setNotes(existing.notes ?? '');
  }, [existing]);

  async function save() {
    const fields = {
      date, flags, notes: notes || undefined,
      updatedAt: new Date().toISOString(),
    };
    if (editId && existing) {
      await db.symptoms.put({ ...existing, ...fields });
    } else {
      await db.symptoms.add({ ...baseFields(), type: 'symptom', ...fields });
    }
    onClose();
  }

  async function handleDelete() {
    if (!editId || !window.confirm('Delete this symptom entry?')) return;
    await db.symptoms.update(editId, { deleted: 1, updatedAt: new Date().toISOString() });
    onClose();
  }

  return (
    <Sheet
      title={editId ? 'Edit symptoms' : 'Symptoms today'}
      onClose={onClose} onSave={save}
      onDelete={editId ? handleDelete : undefined}
      warn={redFlag ? 'Fever or fewer wet nappies can need prompt attention. Consider contacting your doctor.' : undefined}
    >
      <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Present today"><ChipMulti values={flags} onChange={setFlags} options={SYMPTOM_OPTS} /></Field>
      <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Sheet>
  );
}
