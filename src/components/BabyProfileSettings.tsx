// Baby profile (DOB, gestation at birth, sex) → AppSettings singleton.
import { useLiveQuery } from 'dexie-react-hooks';
import { db, baseFields, SETTINGS_ID } from '../db';
import type { AppSettings } from '../db';
import { Field, ChipSelect } from './Fields';

export function BabyProfileSettings() {
  const existing = useLiveQuery(() => db.settings.get(SETTINGS_ID), []);

  async function saveChanges(changes: Partial<AppSettings>) {
    if (existing) {
      await db.settings.put({ ...existing, ...changes, updatedAt: new Date().toISOString() });
    } else {
      await db.settings.add({
        ...baseFields(), ...changes,
        id: SETTINGS_ID, // singleton id overrides the generated one
        type: 'settings',
        associationWindowHours: 2,
      } as AppSettings);
    }
  }

  const parseIntOr = (v: string): number | undefined => (v === '' ? undefined : Number(v));

  return (
    <>
      <div className="section-label">Baby profile</div>
      <Field label="Date of birth">
        <input
          type="date" value={existing?.dob ?? ''}
          onChange={(e) => void saveChanges({ dob: e.target.value || undefined })}
        />
      </Field>
      <div style={{ display: 'flex', gap: 10 }}>
        <Field label="Gestation (weeks)">
          <input
            type="number" inputMode="numeric" placeholder="34" min={20} max={44}
            value={existing?.gestWeeksAtBirth ?? ''}
            onChange={(e) => void saveChanges({ gestWeeksAtBirth: parseIntOr(e.target.value) })}
          />
        </Field>
        <Field label="+ days">
          <input
            type="number" inputMode="numeric" placeholder="0" min={0} max={6}
            value={existing?.gestDaysAtBirth ?? ''}
            onChange={(e) => void saveChanges({ gestDaysAtBirth: parseIntOr(e.target.value) })}
          />
        </Field>
      </div>
      <Field
        label="Sex"
        hint="DOB + gestation set the corrected age used for growth charts."
      >
        <ChipSelect
          value={existing?.sex}
          onChange={(v) => void saveChanges({ sex: v })}
          options={[{ value: 'male', label: 'Boy' }, { value: 'female', label: 'Girl' }]}
        />
      </Field>
    </>
  );
}
