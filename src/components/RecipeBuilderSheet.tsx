// Build (or edit) a "recipe" — a composite dish blended from several
// scanned/searched ingredient components — and save it as an ordinary
// FoodCatalogItem whose per100 was computed from those components. Meal
// logging and computeDailyIntake are unaffected: once saved, a recipe is
// picked at meal time exactly like any other saved dish (see MealSheet's
// pickDish()); the only tell is nutritionSource: 'recipe' + recipeComponents.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, baseFields, newId } from '../db';
import type { FoodCatalogItem, FoodCategory, NutrientProfile } from '../db';
import { Sheet } from './Sheet';
import { Field, ChipSelect } from './Fields';
import { BarcodeScanner } from './BarcodeScanner';
import { FoodLookupSheet } from './FoodLookupSheet';
import { blendPer100, unionIngredientIds } from '../nutrition/blend';
import { reblendDependents } from '../nutrition/cascade';

type Props = { onSave: (catalogId: string) => void; onClose: () => void; editCatalogId?: string };

type ComponentRow = {
  key: string;            // React key only, never persisted
  catalogId: string;
  grams: string;          // controlled input text
  unit: 'g' | 'ml';       // display only — math always treats 1 mL = 1 g
  name: string;
  brand?: string;
  per100?: NutrientProfile;
  ingredientIds: string[];
};

/** Default unit for a newly-added component, from its catalog category:
 *  liquid/formula/breastmilk are naturally measured in mL, everything else
 *  in g. Matches the same category -> unit rule MealSheet uses. */
function defaultUnitForCategory(category: FoodCategory | undefined): 'g' | 'ml' {
  return category === 'liquid' || category === 'formula' || category === 'breastmilk' ? 'ml' : 'g';
}

const CATEGORY_OPTIONS: { value: FoodCategory; label: string }[] = [
  { value: 'puree', label: 'Purée' }, { value: 'solid', label: 'Solid' },
  { value: 'finger-food', label: 'Finger' }, { value: 'liquid', label: 'Liquid' },
  { value: 'formula', label: 'Formula' }, { value: 'breastmilk', label: 'Breastmilk' },
  { value: 'other', label: 'Other' },
];

export function RecipeBuilderSheet({ onSave, onClose, editCatalogId }: Props) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<FoodCategory>('puree');
  const [rows, setRows] = useState<ComponentRow[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [lookupUpc, setLookupUpc] = useState<string>();
  const [searchOpen, setSearchOpen] = useState(false);

  const existing = useLiveQuery(
    () => (editCatalogId ? db.foodCatalog.get(editCatalogId) : undefined),
    [editCatalogId],
  );

  // Focus (and select) the grams input of a just-added row once it renders.
  const focusKeyRef = useRef<string | null>(null);
  const gramsInputRefs = useRef(new Map<string, HTMLInputElement | null>());

  // Edit mode: prefill name/category, then resolve each component's catalog
  // name/brand/per100/ingredientIds via db lookups (recipeComponents only
  // stores {catalogId, grams}).
  useEffect(() => {
    if (!existing) return;
    setName(existing.name);
    setCategory(existing.category);
    let cancelled = false;
    (async () => {
      const comps = existing.recipeComponents ?? [];
      const resolved: ComponentRow[] = [];
      for (const c of comps) {
        const dish = await db.foodCatalog.get(c.catalogId);
        resolved.push({
          key: newId(),
          catalogId: c.catalogId,
          grams: String(c.grams),
          unit: c.unit ?? 'g', // old records saved before Phase 3.6 default to 'g'
          name: dish?.name ?? '(deleted item)',
          brand: dish?.brand,
          per100: dish?.per100,
          ingredientIds: dish?.ingredientIds ?? [],
        });
      }
      if (!cancelled) setRows(resolved);
    })();
    return () => { cancelled = true; };
  }, [existing]);

  useEffect(() => {
    if (!focusKeyRef.current) return;
    const el = gramsInputRefs.current.get(focusKeyRef.current);
    el?.focus();
    el?.select();
    focusKeyRef.current = null;
  }, [rows]);

  const preview = useMemo(
    () => blendPer100(rows.map((r) => ({ per100: r.per100, grams: Number(r.grams) || 0 }))),
    [rows],
  );
  const hasGrams = preview.totalGrams > 0;

  async function addComponent(catalogId: string) {
    const dish = await db.foodCatalog.get(catalogId);
    const key = newId();
    focusKeyRef.current = key;
    setRows((rs) => [...rs, {
      key,
      catalogId,
      grams: '0',
      unit: defaultUnitForCategory(dish?.category),
      name: dish?.name ?? 'Unknown item',
      brand: dish?.brand,
      per100: dish?.per100,
      ingredientIds: dish?.ingredientIds ?? [],
    }]);
  }

  function updateGrams(key: string, value: string) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, grams: value } : r)));
  }

  function updateUnit(key: string, unit: 'g' | 'ml') {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, unit } : r)));
  }

  function removeRow(key: string) {
    setRows((rs) => rs.filter((r) => r.key !== key));
  }

  // FoodLookupSheet already upserted the FoodCatalogItem (with USDA nutrition
  // data, if resolved) and hands back its id — same pattern MealSheet uses.
  async function handleScanResolved(catalogId: string) {
    await addComponent(catalogId);
    setLookupUpc(undefined);
  }

  async function handleSearchResolved(catalogId: string) {
    await addComponent(catalogId);
    setSearchOpen(false);
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) return; // recipe name is required to save

    const componentsForBlend = rows.map((r) => ({ per100: r.per100, grams: Number(r.grams) || 0 }));
    const blended = blendPer100(componentsForBlend);
    const ingredientIds = unionIngredientIds(rows.map((r) => r.ingredientIds));
    const recipeComponents = rows.map((r) => ({ catalogId: r.catalogId, grams: Number(r.grams) || 0, unit: r.unit }));
    const now = new Date().toISOString();
    const fields = {
      name: trimmed,
      category,
      defaultUnit: 'g' as const,
      ingredientIds,
      per100: blended.per100,
      nutritionSource: 'recipe' as const,
      recipeComponents,
      updatedAt: now,
    };

    let id: string;
    if (editCatalogId && existing) {
      await db.foodCatalog.put({ ...existing, ...fields });
      id = editCatalogId;
    } else {
      const rec: FoodCatalogItem = { ...baseFields(), type: 'foodCatalog', ...fields };
      await db.foodCatalog.add(rec);
      id = rec.id;
    }
    // A brand-new recipe can't have existing dependents, but calling this
    // unconditionally (edit AND create) is harmless and simpler than
    // branching — fixes any recipe that uses THIS recipe as a component
    // right away, instead of waiting for the next manual refresh.
    await reblendDependents([id]);
    onSave(id);
    onClose();
  }

  return (
    <>
    <Sheet title={editCatalogId ? 'Edit recipe' : 'Build recipe'} onClose={onClose} onSave={save}>
      <Field label="Recipe name">
        <input
          type="text" placeholder="e.g. Sweet potato & chicken mash"
          value={name} onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Category">
        <ChipSelect value={category} allowClear={false} onChange={(v) => v && setCategory(v)} options={CATEGORY_OPTIONS} />
      </Field>
      <Field
        label="Ingredients"
        hint="Scan a barcode or search USDA for each component, then set its amount and unit. g and mL are treated as equal (density ≈1 at baby-food scale)."
      >
        {rows.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            {rows.map((r) => (
              <div key={r.key} className="recipe-row" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</div>
                  {r.brand && <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>{r.brand}</div>}
                </div>
                <input
                  ref={(el) => { gramsInputRefs.current.set(r.key, el); }}
                  type="number" inputMode="decimal" style={{ width: 72, flex: '0 0 auto' }}
                  value={r.grams} onChange={(e) => updateGrams(r.key, e.target.value)}
                />
                <div style={{ display: 'flex', gap: 4, flex: '0 0 auto' }}>
                  {(['g', 'ml'] as const).map((u) => (
                    <button
                      key={u} type="button"
                      className={`chip ${r.unit === u ? 'on' : ''}`}
                      style={{ padding: '8px 10px', minHeight: 'auto', fontSize: 13 }}
                      onClick={() => updateUnit(r.key, u)}
                    >
                      {u === 'ml' ? 'mL' : 'g'}
                    </button>
                  ))}
                </div>
                <button
                  type="button" className="btn ghost"
                  style={{ flex: '0 0 auto', minHeight: 'auto', padding: '8px 12px' }}
                  onClick={() => removeRow(r.key)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        {hasGrams && (
          <div className="hint" style={{ margin: '-2px 2px 10px' }}>
            Total dish: {Math.round(preview.totalGrams)} g — log this as "given" at meal time, and the app scales nutrition by how much was eaten.
          </div>
        )}
        <div className="choices">
          <button type="button" className="chip" onClick={() => setScannerOpen(true)}>📷 Scan</button>
          <button type="button" className="chip" onClick={() => setSearchOpen(true)}>🔍 Search</button>
        </div>
      </Field>

      {hasGrams && (
        <div className="hint" style={{ margin: '-8px 2px 10px' }}>
          ≈ {Math.round(preview.per100.kcal ?? 0)} kcal per 100 g · nutrition data for {preview.knownCount} of {preview.totalCount} ingredients
        </div>
      )}
      {hasGrams && preview.knownCount < preview.totalCount && (
        <div className="warn-banner">Ingredients without nutrition data count as zero — totals will undercount.</div>
      )}
    </Sheet>
    {scannerOpen && (
      <BarcodeScanner
        onScan={(upc) => { setScannerOpen(false); setLookupUpc(upc); }}
        onClose={() => setScannerOpen(false)}
      />
    )}
    {lookupUpc !== undefined && (
      <FoodLookupSheet
        upc={lookupUpc}
        onSelect={(id) => { void handleScanResolved(id); }}
        onClose={() => setLookupUpc(undefined)}
      />
    )}
    {searchOpen && (
      <FoodLookupSheet
        onSelect={(id) => { void handleSearchResolved(id); }}
        onClose={() => setSearchOpen(false)}
      />
    )}
    </>
  );
}
