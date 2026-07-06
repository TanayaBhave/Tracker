import { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, baseFields, nowLocalISO, isoToLocal } from '../../db';
import type { MedCatalogItem, NutrientProfile } from '../../db';
import { Sheet } from '../Sheet';
import { Field } from '../Fields';
import { BarcodeScanner } from '../BarcodeScanner';
import { MedLookupSheet } from '../MedLookupSheet';

type Props = { onClose: () => void; editId?: string };
const toISO = (local: string) => new Date(local).toISOString();

// Manual "Nutrients per dose" editor rows — same keys/units the Nutrition tab
// reports (see NutritionDay.tsx), so a hand-entered supplement plots exactly
// like a DSLD-resolved one.
const NUTRIENT_FIELDS: { key: keyof NutrientProfile; label: string }[] = [
  { key: 'kcal', label: 'Calories (kcal)' },
  { key: 'protein_g', label: 'Protein (g)' },
  { key: 'fat_g', label: 'Fat (g)' },
  { key: 'carbs_g', label: 'Carbs (g)' },
  { key: 'fiber_g', label: 'Fiber (g)' },
  { key: 'iron_mg', label: 'Iron (mg)' },
  { key: 'calcium_mg', label: 'Calcium (mg)' },
  { key: 'zinc_mg', label: 'Zinc (mg)' },
  { key: 'vitD_ug', label: 'Vitamin D (µg)' },
  { key: 'vitC_mg', label: 'Vitamin C (mg)' },
  { key: 'vitA_ug_rae', label: 'Vitamin A (µg RAE)' },
  { key: 'potassium_mg', label: 'Potassium (mg)' },
  { key: 'sodium_mg', label: 'Sodium (mg)' },
  { key: 'folate_ug', label: 'Folate (µg)' },
  { key: 'vitB12_ug', label: 'Vitamin B12 (µg)' },
];

const QUICK_PICK_CAP = 8;

export function MedSheet({ onClose, editId }: Props) {
  const [when, setWhen] = useState(nowLocalISO());
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('ml');
  const [notes, setNotes] = useState('');
  const [catalogId, setCatalogId] = useState<string>();
  const [remember, setRemember] = useState(false);
  const [nutrientsOpen, setNutrientsOpen] = useState(false);
  const [nutrients, setNutrients] = useState<Partial<Record<keyof NutrientProfile, string>>>({});
  const [scannerOpen, setScannerOpen] = useState(false);
  const [lookupUpc, setLookupUpc] = useState<string>();
  const [lookupOpen, setLookupOpen] = useState(false); // name-search mode (no camera)

  const existing = useLiveQuery(() => editId ? db.meds.get(editId) : undefined, [editId]);
  const catalogRaw = useLiveQuery(
    () => db.medCatalog.where('deleted').equals(0).and((m) => m.archived === 0).toArray(),
    [],
  );
  const catalog = useMemo(() => catalogRaw ?? [], [catalogRaw]);
  // Most-recently-used first: updatedAt desc is a good-enough proxy (a
  // deliberate non-goal to bump updatedAt on every use — that would push a
  // sync row per dose just to reorder chips).
  const quickPicks = useMemo(
    () => [...catalog].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, QUICK_PICK_CAP),
    [catalog],
  );
  const pickedMed = useMemo(() => catalog.find((m) => m.id === catalogId), [catalog, catalogId]);
  const pickedNutrientCount = pickedMed?.perDose
    ? Object.values(pickedMed.perDose).filter((v) => typeof v === 'number').length
    : 0;

  useEffect(() => {
    if (!existing) return;
    setWhen(isoToLocal(existing.timestamp));
    setName(existing.medName);
    setAmount(existing.doseAmount?.toString() ?? '');
    setUnit(existing.doseUnit ?? 'ml');
    setNotes(existing.notes ?? '');
    setCatalogId(existing.catalogId);
  }, [existing]);

  /** Quick-pick / lookup result -> form fill. */
  function applyCatalogItem(item: MedCatalogItem) {
    setName(item.name);
    if (item.defaultDoseAmount !== undefined) setAmount(String(item.defaultDoseAmount));
    if (item.defaultDoseUnit) setUnit(item.defaultDoseUnit);
    setCatalogId(item.id);
    // Prefill the manual editor so "remember" edits start from the known
    // values instead of silently wiping them.
    const next: Partial<Record<keyof NutrientProfile, string>> = {};
    for (const { key } of NUTRIENT_FIELDS) {
      const v = item.perDose?.[key];
      if (typeof v === 'number') next[key] = String(v);
    }
    setNutrients(next);
  }

  async function handleLookupSelect(newCatalogId: string) {
    const item = await db.medCatalog.get(newCatalogId);
    if (item) applyCatalogItem(item);
    setLookupUpc(undefined);
    setLookupOpen(false);
  }

  /** Entered manual nutrients -> profile; undefined when nothing was entered. */
  function enteredPerDose(): NutrientProfile | undefined {
    const profile: NutrientProfile = {};
    let any = false;
    for (const { key } of NUTRIENT_FIELDS) {
      const raw = (nutrients[key] ?? '').trim();
      if (!raw) continue;
      const num = Number(raw);
      if (!Number.isFinite(num)) continue;
      profile[key] = num;
      any = true;
    }
    return any ? profile : undefined;
  }

  /** "Remember this med": upsert a MedCatalogItem — match by the linked
   *  catalogId, else case-insensitive name — carrying the current dose as the
   *  new default. kind stays/becomes 'supplement' when nutrients or a UPC are
   *  attached, else 'medication'. */
  async function upsertMedCatalogItem(trimmedName: string, doseAmount: number | undefined): Promise<string> {
    const now = new Date().toISOString();
    const target = (catalogId && catalog.find((m) => m.id === catalogId))
      || catalog.find((m) => m.name.toLowerCase() === trimmedName.toLowerCase());
    const perDose = enteredPerDose() ?? target?.perDose;
    const fields = {
      name: trimmedName,
      kind: (perDose || target?.upc) ? 'supplement' as const : 'medication' as const,
      defaultDoseAmount: doseAmount,
      defaultDoseUnit: unit || undefined,
      perDose,
      updatedAt: now,
    };
    if (target) {
      await db.medCatalog.put({ ...target, ...fields });
      return target.id;
    }
    const rec: MedCatalogItem = { ...baseFields(), type: 'medCatalog', archived: 0, ...fields };
    await db.medCatalog.add(rec);
    return rec.id;
  }

  async function save() {
    const trimmedName = name.trim();
    const doseAmount = amount ? Number(amount) : undefined;
    let doseCatalogId = catalogId;
    if (remember && trimmedName) {
      doseCatalogId = await upsertMedCatalogItem(trimmedName, doseAmount);
    }
    const fields = {
      timestamp: toISO(when),
      medName: trimmedName || 'Medication',
      doseAmount,
      doseUnit: unit,
      catalogId: doseCatalogId,
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
    <>
    <Sheet
      title={editId ? 'Edit medication' : 'Log medication'}
      onClose={onClose} onSave={save}
      onDelete={editId ? handleDelete : undefined}
    >
      {quickPicks.length > 0 && (
        <Field label="Quick pick">
          <div className="choices">
            {quickPicks.map((m) => (
              <button
                key={m.id} type="button"
                className={`chip ${catalogId === m.id ? 'on' : ''}`}
                onClick={() => applyCatalogItem(m)}
              >
                {m.name}
              </button>
            ))}
          </div>
          {pickedMed && pickedNutrientCount > 0 && (
            <div className="hint" style={{ margin: '6px 2px 0' }}>
              Includes {pickedNutrientCount} nutrient{pickedNutrientCount === 1 ? '' : 's'} per dose — counted in the Nutrition tab.
            </div>
          )}
        </Field>
      )}
      <Field label="Time"><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
      <Field label="Medication">
        <input
          type="text" value={name}
          onChange={(e) => {
            setName(e.target.value);
            setCatalogId(undefined); // typed name no longer matches the picked item
          }}
        />
        <div className="choices" style={{ marginTop: 8 }}>
          <button type="button" className="chip" onClick={() => setScannerOpen(true)}>📷 Scan</button>
          <button type="button" className="chip" onClick={() => setLookupOpen(true)}>🔍 Look up</button>
        </div>
      </Field>
      <div style={{ display: 'flex', gap: 10 }}>
        <Field label="Dose"><input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Unit"><input type="text" value={unit} onChange={(e) => setUnit(e.target.value)} /></Field>
      </div>
      <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>

      <div className="field">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
            style={{ width: 20, height: 20 }}
          />
          Remember this med
        </label>
        <div className="hint" style={{ margin: '6px 2px 0' }}>Saves the name + dose as a quick-pick chip for next time.</div>
      </div>

      {remember && (
        <div className="more-detail">
          <button
            type="button"
            className="more-detail-toggle"
            onClick={() => setNutrientsOpen((o) => !o)}
            aria-expanded={nutrientsOpen}
          >
            <span>Nutrients per dose (optional)</span>
            <span className={`chev ${nutrientsOpen ? 'open' : ''}`}>⌄</span>
          </button>
          {nutrientsOpen && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 10px', paddingBottom: 8 }}>
              {NUTRIENT_FIELDS.map(({ key, label }) => (
                <div key={key} className="field" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: 12 }}>{label}</label>
                  <input
                    type="number" inputMode="decimal"
                    value={nutrients[key] ?? ''}
                    onChange={(e) => setNutrients((n) => ({ ...n, [key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Sheet>
    {scannerOpen && (
      <BarcodeScanner
        onScan={(upc) => { setScannerOpen(false); setLookupUpc(upc); }}
        onClose={() => setScannerOpen(false)}
      />
    )}
    {lookupUpc !== undefined && (
      <MedLookupSheet
        upc={lookupUpc}
        onSelect={(id) => { void handleLookupSelect(id); }}
        onClose={() => setLookupUpc(undefined)}
      />
    )}
    {lookupOpen && (
      <MedLookupSheet
        onSelect={(id) => { void handleLookupSelect(id); }}
        onClose={() => setLookupOpen(false)}
      />
    )}
    </>
  );
}
