import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, baseFields, nowLocalISO, isoToLocal } from '../../db';
import type { VomitSeverity, VomitAppearance, VomitForce, BodyPosition } from '../../db';
import { Sheet } from '../Sheet';
import { Field, ChipSelect } from '../Fields';

type Props = { onClose: () => void; editId?: string };
const toISO = (local: string) => new Date(local).toISOString();

export function VomitSheet({ onClose, editId }: Props) {
  const [when, setWhen] = useState(nowLocalISO());
  const [severity, setSeverity] = useState<VomitSeverity>('moderate');
  const [appearance, setAppearance] = useState<VomitAppearance>();
  const [force, setForce] = useState<VomitForce>();
  const [position, setPosition] = useState<BodyPosition>();
  const [notes, setNotes] = useState('');

  const existing = useLiveQuery(() => editId ? db.vomits.get(editId) : undefined, [editId]);

  useEffect(() => {
    if (!existing) return;
    setWhen(isoToLocal(existing.timestamp));
    setSeverity(existing.severity);
    setAppearance(existing.appearance);
    setForce(existing.forcefulness);
    setPosition(existing.bodyPosition);
    setNotes(existing.notes ?? '');
  }, [existing]);

  const redFlag = appearance === 'bile-green' || appearance === 'bloody-streak' || force === 'projectile';

  async function save() {
    const fields = {
      timestamp: toISO(when),
      severity, appearance, forcefulness: force, bodyPosition: position,
      notes: notes || undefined,
      updatedAt: new Date().toISOString(),
    };
    if (editId && existing) {
      await db.vomits.put({ ...existing, ...fields });
    } else {
      await db.vomits.add({ ...baseFields(), type: 'vomit', ...fields });
    }
    onClose();
  }

  async function handleDelete() {
    if (!editId || !window.confirm('Delete this vomit entry?')) return;
    await db.vomits.update(editId, { deleted: 1, updatedAt: new Date().toISOString() });
    onClose();
  }

  return (
    <Sheet
      title={editId ? 'Edit vomit' : 'Log vomit'}
      onClose={onClose} onSave={save}
      onDelete={editId ? handleDelete : undefined}
      warn={redFlag ? 'Green/bile, blood, or projectile vomiting can need prompt medical attention. Consider contacting your doctor.' : undefined}
    >
      <Field label="Time"><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
      <Field label="Amount">
        <ChipSelect value={severity} allowClear={false} onChange={(v) => v && setSeverity(v)} options={[
          { value: 'spit-up', label: 'Spit-up' }, { value: 'moderate', label: 'Moderate' }, { value: 'large', label: 'Large' },
        ]} />
      </Field>
      <Field label="Forcefulness">
        <ChipSelect value={force} onChange={setForce} options={[
          { value: 'effortless', label: 'Effortless' }, { value: 'moderate', label: 'Moderate' },
          { value: 'projectile', label: 'Projectile', tone: 'alert' },
        ]} />
      </Field>
      <Field label="Appearance">
        <ChipSelect value={appearance} onChange={setAppearance} options={[
          { value: 'milky-undigested', label: 'Milky' }, { value: 'partially-digested', label: 'Part-digested' },
          { value: 'mucousy', label: 'Mucousy' }, { value: 'bloody-streak', label: 'Blood', tone: 'alert' },
          { value: 'bile-green', label: 'Green/bile', tone: 'alert' }, { value: 'other', label: 'Other' },
        ]} />
      </Field>
      <Field label="Position when it happened">
        <ChipSelect value={position} onChange={setPosition} options={[
          { value: 'lying-flat', label: 'Lying flat' }, { value: 'upright', label: 'Upright' },
          { value: 'reclined', label: 'Reclined' }, { value: 'during-after-feed', label: 'During/after feed' },
          { value: 'car-ride', label: 'Car ride' },
        ]} />
      </Field>
      <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Sheet>
  );
}
