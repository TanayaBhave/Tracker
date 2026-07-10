// Log (or edit) one occurrence of a user-defined Factor (see FactorManagerSheet
// for creating/archiving the Factors themselves). Form fields branch on the
// parent Factor's `kind`: instant -> timestamp, duration -> start/end (end
// optional/open-ended, same convention as SleepSheet), scale -> timestamp +
// a 0-5 value. `factorId` is only required when creating a brand-new event
// (passed by FactorManagerSheet's "Log" button); when opened by `editId`
// alone (e.g. a Timeline row tap routed through App.tsx's SHEETS map), the
// Factor is resolved from the existing FactorEvent's own `factorId`.
import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  db, baseFields, nowLocalISO, nowLocalISOOnDate, isoToLocal,
} from '../../db';
import type { FactorKind } from '../../db';
import { Sheet } from '../Sheet';
import { Field } from '../Fields';

type Props = { onClose: () => void; editId?: string; factorId?: string; defaultDate?: string };
const toISO = (local: string) => new Date(local).toISOString();

export function FactorEventSheet({
  onClose, editId, factorId, defaultDate,
}: Props) {
  const [when, setWhen] = useState(defaultDate ? nowLocalISOOnDate(defaultDate) : nowLocalISO());
  const [start, setStart] = useState(defaultDate ? nowLocalISOOnDate(defaultDate) : nowLocalISO());
  const [end, setEnd] = useState('');
  const [value, setValue] = useState('');
  const [notes, setNotes] = useState('');
  // Defaults to 'instant' so the form renders something reasonable on the
  // first tick before the parent Factor has resolved (mirrors how every
  // other sheet renders immediately and back-fills via useEffect once its
  // `existing` record arrives, rather than returning null while loading).
  const [kind, setKind] = useState<FactorKind>('instant');

  const existing = useLiveQuery(() => (editId ? db.factorEvents.get(editId) : undefined), [editId]);
  const effectiveFactorId = existing?.factorId ?? factorId;
  const factor = useLiveQuery(
    () => (effectiveFactorId ? db.factors.get(effectiveFactorId) : undefined),
    [effectiveFactorId],
  );

  useEffect(() => {
    if (factor) setKind(factor.kind);
  }, [factor]);

  useEffect(() => {
    if (!existing) return;
    setNotes(existing.notes ?? '');
    if (existing.timestamp) setWhen(isoToLocal(existing.timestamp));
    if (existing.startTime) setStart(isoToLocal(existing.startTime));
    if (existing.endTime) setEnd(isoToLocal(existing.endTime));
    if (existing.value !== undefined) setValue(String(existing.value));
  }, [existing]);

  async function save() {
    if (!effectiveFactorId) return;
    const now = new Date().toISOString();
    const fields = {
      factorId: effectiveFactorId,
      timestamp: kind === 'duration' ? undefined : toISO(when),
      startTime: kind === 'duration' ? toISO(start) : undefined,
      endTime: kind === 'duration' && end ? toISO(end) : undefined,
      value: kind === 'scale' && value !== '' ? Number(value) : undefined,
      notes: notes || undefined,
      updatedAt: now,
    };
    if (editId && existing) {
      await db.factorEvents.put({ ...existing, ...fields });
    } else {
      await db.factorEvents.add({ ...baseFields(), type: 'factorEvent', ...fields });
    }
    onClose();
  }

  async function handleDelete() {
    if (!editId || !window.confirm('Delete this entry?')) return;
    await db.factorEvents.update(editId, { deleted: 1, updatedAt: new Date().toISOString() });
    onClose();
  }

  const title = `${editId ? 'Edit' : 'Log'} ${factor?.name ?? 'factor'}`;

  return (
    <Sheet
      title={title}
      onClose={onClose} onSave={save}
      onDelete={editId ? handleDelete : undefined}
    >
      {kind === 'instant' && (
        <Field label="Time"><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
      )}
      {kind === 'duration' && (
        <>
          <Field label="Start"><input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="End" hint="Leave blank if still ongoing."><input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </>
      )}
      {kind === 'scale' && (
        <>
          <Field label="Time"><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
          <Field label={`Value${factor?.unit ? ` (${factor.unit})` : ' (0-5)'}`}>
            <input type="number" inputMode="decimal" min={0} max={5} step={1} value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
        </>
      )}
      <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Sheet>
  );
}
