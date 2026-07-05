import { useState } from 'react';
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
export function SymptomSheet({ onClose }: { onClose: () => void }) {
  const [date, setDate] = useState(todayStr());
  const [flags, setFlags] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const redFlag = flags.includes('fever') || flags.includes('fewer-wet-diapers');
  async function save() {
    await db.symptoms.add({ ...baseFields(), type: 'symptom', date, flags, notes: notes || undefined });
    onClose();
  }
  return (
    <Sheet title="Symptoms today" onClose={onClose} onSave={save}
      warn={redFlag ? 'Fever or fewer wet nappies can need prompt attention. Consider contacting your doctor.' : undefined}>
      <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Present today"><ChipMulti values={flags} onChange={setFlags} options={SYMPTOM_OPTS} /></Field>
      <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Sheet>
  );
}
