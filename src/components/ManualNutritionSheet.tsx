// Fallback for when USDA has no match (Phase 3.5, S1): the parent types the
// nutrition facts straight off the physical product label. Opened from
// FoodLookupSheet either after a scanned UPC misses ("upc-not-found") or from
// an always-available "Can't find it?" link during a name search — mirrors
// the USDA path's contract (`onSelect(catalogId)`) so MealSheet/RecipeBuilderSheet
// continue identically either way.
import { useState } from 'react';
import { db, baseFields } from '../db';
import type { FoodCatalogItem, NutrientProfile } from '../db';
import { Sheet } from './Sheet';
import { Field, ChipSelect } from './Fields';
import { findOrCreateIngredient } from './FoodLookupSheet';

type Props = {
  upc?: string;
  initialName?: string;
  onSelect: (catalogId: string) => void;
  onClose: () => void;
};

// Same nutrient list/labels as MedSheet's manual "Nutrients per dose" editor
// (src/components/sheets/MedSheet.tsx) so a hand-entered label reads exactly
// like a MedSheet/USDA-sourced profile everywhere downstream (blend.ts,
// NutritionDay.tsx). Duplicated rather than imported — MedSheet is a sheet
// component, not a shared module, and this list is small/stable enough that
// this mirrors the convention already used there.
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

type Basis = 'serving' | '100g';

export function ManualNutritionSheet({ upc, initialName, onSelect, onClose }: Props) {
  const [name, setName] = useState(initialName ?? '');
  const [brand, setBrand] = useState('');
  const [servingGrams, setServingGrams] = useState('');
  const [basis, setBasis] = useState<Basis>('serving');
  const [nutrients, setNutrients] = useState<Partial<Record<keyof NutrientProfile, string>>>({});
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  /** Entered nutrient strings -> a per-100g NutrientProfile; undefined when
   *  nothing was entered. Sparse: a blank field is omitted, never 0-filled
   *  (see src/nutrition/blend.ts's "honest undercount" convention). In
   *  'serving' mode each value is converted value * 100 / gramsNum; in
   *  '100g' mode the typed value is already per-100g and passes through. */
  function computePer100(gramsNum: number | undefined): NutrientProfile | undefined {
    const profile: NutrientProfile = {};
    let any = false;
    for (const { key } of NUTRIENT_FIELDS) {
      const raw = (nutrients[key] ?? '').trim();
      if (!raw) continue;
      const num = Number(raw);
      if (!Number.isFinite(num)) continue;
      profile[key] = basis === 'serving' && gramsNum ? (num * 100) / gramsNum : num;
      any = true;
    }
    return any ? profile : undefined;
  }

  async function save() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Product name is required.');
      return;
    }
    const gramsNum = servingGrams.trim() ? Number(servingGrams) : undefined;
    const hasAnyNutrient = NUTRIENT_FIELDS.some(({ key }) => (nutrients[key] ?? '').trim());
    if (basis === 'serving' && hasAnyNutrient && !(gramsNum && gramsNum > 0)) {
      setError('Enter the serving size in grams/ml from the label to convert to per-100g — or switch to "Per 100 g" and enter values directly.');
      return;
    }
    setError(undefined);
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const trimmedBrand = brand.trim() || undefined;
      const per100 = computePer100(gramsNum);
      // Dedupe by the scanned UPC (if any) so re-saving the same product
      // updates its catalog entry instead of creating a duplicate — same
      // contract as FoodLookupSheet's upsertCatalogFromUsda.
      const existing = upc ? await db.foodCatalog.where('upc').equals(upc).first() : undefined;
      const ingredientIds = existing && existing.ingredientIds.length > 0
        ? existing.ingredientIds
        : [await findOrCreateIngredient(trimmedName, trimmedBrand)];
      const fields = {
        name: trimmedName,
        brand: trimmedBrand,
        upc,
        per100,
        servingGrams: gramsNum,
        nutritionSource: 'manual' as const,
        ingredientIds,
        updatedAt: now,
      };
      let id: string;
      if (existing) {
        await db.foodCatalog.put({ ...existing, ...fields });
        id = existing.id;
      } else {
        const rec: FoodCatalogItem = {
          ...baseFields(), type: 'foodCatalog', category: 'other', defaultUnit: 'g', ...fields,
        };
        await db.foodCatalog.add(rec);
        id = rec.id;
      }
      onSelect(id);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      title="Enter nutrition from label"
      onClose={onClose}
      onSave={() => { void save(); }}
      saveLabel={saving ? 'Saving…' : 'Save'}
      warn={error}
    >
      <Field label="Product name">
        <input
          type="text" placeholder="e.g. Organic Sweet Potato Puree"
          value={name} onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Brand (optional)">
        <input type="text" value={brand} onChange={(e) => setBrand(e.target.value)} />
      </Field>
      {upc && (
        <div className="hint" style={{ margin: '-8px 2px 14px' }}>
          Scanned UPC {upc} will be saved with this item, so the next scan resolves offline.
        </div>
      )}
      <Field label="Nutrition facts on the label are...">
        <ChipSelect
          value={basis}
          allowClear={false}
          onChange={(v) => v && setBasis(v)}
          options={[
            { value: 'serving', label: 'Per serving' },
            { value: '100g', label: 'Per 100 g' },
          ]}
        />
      </Field>
      <Field
        label={basis === 'serving' ? 'Serving size (g/ml, as printed on label)' : 'Serving size (g/ml, optional)'}
        hint={basis === 'serving' ? 'Needed to convert the label\'s per-serving values to per-100g.' : undefined}
      >
        <input
          type="number" inputMode="decimal"
          value={servingGrams} onChange={(e) => setServingGrams(e.target.value)}
        />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 10px', paddingBottom: 8 }}>
        {NUTRIENT_FIELDS.map(({ key, label }) => (
          <div key={key} className="field" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: 12 }}>{label}{basis === 'serving' ? ' / serving' : ' / 100g'}</label>
            <input
              type="number" inputMode="decimal"
              value={nutrients[key] ?? ''}
              onChange={(e) => setNutrients((n) => ({ ...n, [key]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <div className="hint" style={{ margin: '4px 2px 0' }}>
        Leave any nutrient blank if it isn't printed on the label — blank stays unknown rather than counting as zero.
      </div>
    </Sheet>
  );
}
