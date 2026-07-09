// Fallback for when USDA has no match (Phase 3.5, S1): the parent types the
// nutrition facts straight off the physical product label. Opened from
// FoodLookupSheet either after a scanned UPC misses ("upc-not-found") or from
// an always-available "Can't find it?" link during a name search — mirrors
// the USDA path's contract (`onSelect(catalogId)`) so MealSheet/RecipeBuilderSheet
// continue identically either way.
import { useEffect, useState } from 'react';
import { db, baseFields } from '../db';
import type { FoodCatalogItem, FoodCategory, NutrientProfile } from '../db';
import { Sheet } from './Sheet';
import { Field, ChipSelect } from './Fields';
import { findOrCreateIngredient } from './FoodLookupSheet';
import { reblendDependents } from '../nutrition/cascade';

type Props = {
  upc?: string;
  initialName?: string;
  /** When set, edits this existing plain (non-recipe) catalog item in place
   *  instead of creating a new one — the only edit path for a plain item
   *  (RecipeBuilderSheet only opens for recipes). */
  editCatalogId?: string;
  onSelect: (catalogId: string) => void;
  onClose: () => void;
};

// Same list/order as RecipeBuilderSheet's local CATEGORY_OPTIONS — duplicated
// rather than imported, matching this file's established convention (see
// NUTRIENT_FIELDS comment below) of duplicating small, stable option lists
// across sheet components instead of sharing them.
const CATEGORY_OPTIONS: { value: FoodCategory; label: string }[] = [
  { value: 'puree', label: 'Purée' }, { value: 'solid', label: 'Solid' },
  { value: 'finger-food', label: 'Finger' }, { value: 'liquid', label: 'Liquid' },
  { value: 'formula', label: 'Formula' }, { value: 'breastmilk', label: 'Breastmilk' },
  { value: 'other', label: 'Other' },
];

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
  { key: 'sugar_g', label: 'Total sugar (g)' },
  { key: 'addedSugar_g', label: 'Added sugar (g)' },
];

type Basis = 'serving' | '100g';

export function ManualNutritionSheet({ upc, initialName, editCatalogId, onSelect, onClose }: Props) {
  const [name, setName] = useState(initialName ?? '');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState<FoodCategory>('other');
  const [servingGrams, setServingGrams] = useState('');
  // Edit mode defaults to '100g': the stored per100 is already per-100g, so
  // prefilling it is a lossless direct passthrough — back-deriving a "per
  // serving" figure would be lossy round-trip math for no benefit.
  const [basis, setBasis] = useState<Basis>(editCatalogId ? '100g' : 'serving');
  const [nutrients, setNutrients] = useState<Partial<Record<keyof NutrientProfile, string>>>({});
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  // Load and prefill from the existing catalog item when editing.
  useEffect(() => {
    if (!editCatalogId) return;
    void (async () => {
      const existing = await db.foodCatalog.get(editCatalogId);
      if (!existing) return;
      setName(existing.name);
      setBrand(existing.brand ?? '');
      setCategory(existing.category);
      setServingGrams(existing.servingGrams != null ? String(existing.servingGrams) : '');
      if (existing.per100) {
        const prefill: Partial<Record<keyof NutrientProfile, string>> = {};
        for (const { key } of NUTRIENT_FIELDS) {
          const v = existing.per100[key];
          if (v != null) prefill[key] = String(v);
        }
        setNutrients(prefill);
      }
    })();
  }, [editCatalogId]);

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

      if (editCatalogId) {
        const existingRec = await db.foodCatalog.get(editCatalogId);
        if (!existingRec) {
          setError('Item not found.');
          return;
        }
        // Narrow, explicit change set — everything else on the record
        // (upc, fdcId, ingredientIds, defaultUnit, lastFetchedAt,
        // recipeComponents, ...) passes through untouched via the spread.
        // nutritionSource is deliberately NOT set here: if this is a
        // USDA-sourced item, leaving it as 'usda' means a future "Refresh
        // nutrition data" can still re-fetch and overwrite the user's
        // correction — an accepted tradeoff, not a bug.
        const changes = {
          name: trimmedName,
          brand: trimmedBrand,
          category,
          per100,
          servingGrams: gramsNum,
          updatedAt: now,
        };
        await db.foodCatalog.put({ ...existingRec, ...changes });
        await reblendDependents([editCatalogId]);
        onSelect(editCatalogId);
        return;
      }

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
          ...baseFields(), type: 'foodCatalog', category, defaultUnit: 'g', ...fields,
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
      title={editCatalogId ? 'Edit food' : 'Enter nutrition from label'}
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
      <Field label="Category">
        <ChipSelect
          value={category}
          allowClear={false}
          onChange={(v) => v && setCategory(v)}
          options={CATEGORY_OPTIONS}
        />
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
