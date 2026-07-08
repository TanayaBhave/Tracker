import { useMemo, useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, baseFields, nowLocalISO, isoToLocal } from '../../db';
import type {
  Meal, FoodItem, FoodCatalogItem, MealReaction, Texture, PacePosition, OralMotorTag, Burped,
} from '../../db';
import { Sheet } from '../Sheet';
import { Field, ChipSelect, ChipMulti } from '../Fields';
import { IngredientPicker } from '../IngredientPicker';
import { BarcodeScanner } from '../BarcodeScanner';
import { FoodLookupSheet } from '../FoodLookupSheet';
import { RecipeBuilderSheet } from '../RecipeBuilderSheet';

type Props = { onClose: () => void; editId?: string };
const toISO = (local: string) => new Date(local).toISOString();

/** Default amount unit for a category — liquids are naturally measured in mL,
 *  everything else in g. Just the starting point: the user can override it
 *  with the Unit chip below, per meal. */
function defaultUnitForCategory(category: FoodItem['category']): 'g' | 'ml' {
  return category === 'liquid' || category === 'formula' || category === 'breastmilk' ? 'ml' : 'g';
}

export function MealSheet({ onClose, editId }: Props) {
  const [when, setWhen] = useState(nowLocalISO());
  const [foodName, setFoodName] = useState('');
  const [catalogId, setCatalogId] = useState<string>();
  const [ingredientIds, setIngredientIds] = useState<string[]>([]);
  const [category, setCategory] = useState<FoodItem['category']>('puree');
  const [unit, setUnit] = useState<'g' | 'ml'>('g');
  const [amountGiven, setAmountGiven] = useState('');
  const [amountConsumed, setAmountConsumed] = useState('');
  const [duration, setDuration] = useState('');
  const [texture, setTexture] = useState<Texture>();
  const [pace, setPace] = useState<PacePosition>();
  const [oral, setOral] = useState<OralMotorTag[]>([]);
  const [burped, setBurped] = useState<Burped>();
  const [reaction, setReaction] = useState<MealReaction>('none');
  const [notes, setNotes] = useState('');
  const [saveAsDish, setSaveAsDish] = useState(false);
  const [showDishSuggestions, setShowDishSuggestions] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  // W4 Phase-3: barcode scan -> USDA lookup -> autofill Food, chained through the
  // same pickDish() the existing dish-autocomplete uses below.
  const [scannerOpen, setScannerOpen] = useState(false);
  const [lookupUpc, setLookupUpc] = useState<string>();
  // Name-search lookup (no camera) for barcode-less ingredients — fresh
  // produce, bulk goods. Same FoodLookupSheet, opened straight in search mode.
  const [lookupOpen, setLookupOpen] = useState(false);
  // Recipe/composite-dish feature: "Build recipe" opens RecipeBuilderSheet;
  // its onSave hands back a catalog id that's routed through the same
  // pickDish() path as a scanned/searched product below.
  const [recipeBuilderOpen, setRecipeBuilderOpen] = useState(false);

  const existing = useLiveQuery(() => editId ? db.meals.get(editId) : undefined, [editId]);
  const catalogRaw = useLiveQuery(() => db.foodCatalog.where('deleted').equals(0).toArray(), []);
  const catalog = useMemo(() => catalogRaw ?? [], [catalogRaw]);
  const pickedDish = useMemo(() => catalog.find((c) => c.id === catalogId), [catalog, catalogId]);
  const isRecipe = !!pickedDish?.recipeComponents?.length;

  useEffect(() => {
    if (!existing) return;
    setWhen(isoToLocal(existing.timestamp));
    setFoodName(existing.foodItems[0]?.name ?? '');
    setCatalogId(existing.foodItems[0]?.catalogId);
    setIngredientIds(existing.foodItems[0]?.ingredientIds ?? []);
    const existingCategory = existing.foodItems[0]?.category ?? 'puree';
    setCategory(existingCategory);
    setUnit(existing.foodItems[0]?.unit ?? defaultUnitForCategory(existingCategory));
    setAmountGiven(existing.foodItems[0]?.amountGiven?.toString() ?? '');
    setAmountConsumed(existing.foodItems[0]?.amountConsumed?.toString() ?? '');
    setDuration(existing.durationMinutes?.toString() ?? '');
    setTexture(existing.texture);
    setPace(existing.pacePosition);
    setOral(existing.oralMotorTags);
    setBurped(existing.burped);
    setReaction(existing.reaction);
    setNotes(existing.notes ?? '');
    // Auto-expand "More detail" on edit when any of its fields already carry a value.
    setDetailOpen(!!(
      existing.texture || existing.pacePosition || existing.oralMotorTags.length
      || existing.burped || (existing.reaction && existing.reaction !== 'none') || existing.notes
    ));
  }, [existing]);

  const dishQuery = foodName.trim().toLowerCase();
  const dishSuggestions = useMemo(
    () => (showDishSuggestions && dishQuery
      ? catalog.filter((c) => c.name.toLowerCase().includes(dishQuery)).slice(0, 5)
      : []),
    [catalog, dishQuery, showDishSuggestions],
  );

  function pickDish(dish: FoodCatalogItem) {
    setFoodName(dish.name);
    setCategory(dish.category);
    setUnit(defaultUnitForCategory(dish.category));
    setIngredientIds(dish.ingredientIds);
    setCatalogId(dish.id);
    setShowDishSuggestions(false);
  }

  // W4 Phase-3: FoodLookupSheet already upserted the FoodCatalogItem (with USDA
  // nutrition data) and hands back its id — fetch it fresh (rather than reading
  // from the `catalog` live-query snapshot, which may not have re-rendered yet)
  // and reuse pickDish so this behaves exactly like picking an existing dish.
  async function handleFoodLookupSelect(newCatalogId: string) {
    const dish = await db.foodCatalog.get(newCatalogId);
    if (dish) pickDish(dish);
    setLookupUpc(undefined);
    setLookupOpen(false);
  }

  // Recipe builder hands back the (new or re-saved) catalog id; re-fetch so an
  // edited recipe's refreshed blended per100/ingredients land in the form.
  async function handleRecipeSave(newCatalogId: string) {
    const dish = await db.foodCatalog.get(newCatalogId);
    if (dish) pickDish(dish);
  }

  async function upsertCatalogItem(name: string): Promise<string> {
    const now = new Date().toISOString();
    const fields = { name, category, defaultUnit: unit, ingredientIds, updatedAt: now };
    // Prefer the dish this meal already links to, else match by name (case-insensitive).
    const target = (catalogId && catalog.find((c) => c.id === catalogId))
      || catalog.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (target) {
      await db.foodCatalog.put({ ...target, ...fields });
      return target.id;
    }
    const rec: FoodCatalogItem = {
      ...baseFields(), type: 'foodCatalog', ...fields, nutritionSource: 'none',
    };
    await db.foodCatalog.add(rec);
    return rec.id;
  }

  async function save() {
    const name = foodName.trim() || 'Meal';
    let itemCatalogId = catalogId;
    if (saveAsDish && foodName.trim()) {
      itemCatalogId = await upsertCatalogItem(name);
    }
    const item: FoodItem = {
      name,
      category,
      amountGiven: amountGiven ? Number(amountGiven) : undefined,
      amountConsumed: amountConsumed ? Number(amountConsumed) : undefined,
      unit,
      ingredientIds,
      catalogId: itemCatalogId,
    };
    const fields: Partial<Meal> = {
      timestamp: toISO(when),
      durationMinutes: duration ? Number(duration) : undefined,
      foodItems: [item],
      texture, pacePosition: pace, oralMotorTags: oral, burped, reaction,
      notes: notes || undefined,
      updatedAt: new Date().toISOString(),
    };
    if (editId && existing) {
      await db.meals.put({ ...existing, ...fields });
    } else {
      await db.meals.add({ ...baseFields(), type: 'meal', ...fields } as Meal);
    }
    onClose();
  }

  async function handleDelete() {
    if (!editId || !window.confirm('Delete this meal?')) return;
    await db.meals.update(editId, { deleted: 1, updatedAt: new Date().toISOString() });
    onClose();
  }

  return (
    <>
    <Sheet
      title={editId ? 'Edit meal' : 'Add meal'}
      onClose={onClose} onSave={save}
      onDelete={editId ? handleDelete : undefined}
    >
      <Field label="Time"><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
      <Field label="Food">
        <input
          type="text" placeholder="e.g. Sweet potato puree" value={foodName}
          onChange={(e) => {
            setFoodName(e.target.value);
            setCatalogId(undefined); // typed name no longer matches the picked dish
            setShowDishSuggestions(true);
          }}
        />
        <div className="choices" style={{ marginTop: 8 }}>
          <button type="button" className="chip" onClick={() => setScannerOpen(true)}>📷 Scan UPC</button>
          <button type="button" className="chip" onClick={() => setLookupOpen(true)}>🔍 Look up</button>
          <button type="button" className="chip" onClick={() => setRecipeBuilderOpen(true)}>
            {isRecipe ? '🧪 Edit recipe' : '🧪 Build recipe'}
          </button>
        </div>
        {dishSuggestions.length > 0 && (
          <div className="choices" style={{ marginTop: 8 }}>
            {dishSuggestions.map((c) => (
              <button key={c.id} type="button" className="chip" onClick={() => pickDish(c)}>{c.name}</button>
            ))}
          </div>
        )}
      </Field>
      <Field label="Ingredients" hint="Lets you spot a single ingredient across meals later.">
        <IngredientPicker value={ingredientIds} onChange={setIngredientIds} />
      </Field>
      <Field label="Category">
        <ChipSelect
          value={category}
          allowClear={false}
          onChange={(v) => { if (v) { setCategory(v); setUnit(defaultUnitForCategory(v)); } }}
          options={[
            { value: 'puree', label: 'Purée' }, { value: 'solid', label: 'Solid' },
            { value: 'finger-food', label: 'Finger' }, { value: 'liquid', label: 'Liquid' },
            { value: 'formula', label: 'Formula' }, { value: 'breastmilk', label: 'Breastmilk' },
            { value: 'other', label: 'Other' },
          ]}
        />
      </Field>
      <Field label="Unit" hint="Defaults from category — tap to override for this meal.">
        <ChipSelect
          value={unit}
          allowClear={false}
          onChange={(v) => v && setUnit(v)}
          options={[{ value: 'g', label: 'Grams (g)' }, { value: 'ml', label: 'Milliliters (mL)' }]}
        />
      </Field>
      <div style={{ display: 'flex', gap: 10 }}>
        <Field label={`Given (${unit === 'ml' ? 'mL' : 'g'})`}><input type="number" inputMode="decimal" value={amountGiven} onChange={(e) => setAmountGiven(e.target.value)} /></Field>
        <Field label={`Eaten (${unit === 'ml' ? 'mL' : 'g'})`}><input type="number" inputMode="decimal" value={amountConsumed} onChange={(e) => setAmountConsumed(e.target.value)} /></Field>
        <Field label="Mins"><input type="number" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} /></Field>
      </div>

      <div className="more-detail">
        <button
          type="button"
          className="more-detail-toggle"
          onClick={() => setDetailOpen((o) => !o)}
          aria-expanded={detailOpen}
        >
          <span>More detail</span>
          <span className={`chev ${detailOpen ? 'open' : ''}`}>⌄</span>
        </button>
        {detailOpen && (
          <div className="more-detail-body">
            <Field label="Texture" hint="A suspected trigger — worth tagging.">
              <ChipSelect value={texture} onChange={setTexture} options={[
                { value: 'smooth-puree', label: 'Smooth' }, { value: 'mashed', label: 'Mashed' },
                { value: 'lumpy', label: 'Lumpy' }, { value: 'soft-solid', label: 'Soft solid' },
                { value: 'hard-solid', label: 'Hard solid' }, { value: 'mixed', label: 'Mixed' },
              ]} />
            </Field>
            <Field label="Feeding pace / position">
              <ChipSelect value={pace} onChange={setPace} options={[
                { value: 'paced-upright', label: 'Paced, upright', tone: 'calm' },
                { value: 'fast', label: 'Fast' }, { value: 'lying-back', label: 'Lying back' },
              ]} />
            </Field>
            <Field label="Eating signs">
              <ChipMulti values={oral} onChange={setOral} options={[
                { value: 'ate-smoothly', label: 'Ate smoothly', tone: 'calm' },
                { value: 'gagged', label: 'Gagged' }, { value: 'coughed-choked', label: 'Coughed' },
                { value: 'spit-food-out', label: 'Spat out' }, { value: 'pocketed-in-cheeks', label: 'Pocketed' },
                { value: 'trouble-swallowing', label: 'Hard to swallow' }, { value: 'tongue-thrust', label: 'Tongue-thrust' },
              ]} />
            </Field>
            <Field label="Burped after?">
              <ChipSelect value={burped} onChange={setBurped} options={[
                { value: 'yes', label: 'Yes', tone: 'calm' }, { value: 'partial', label: 'Partial' }, { value: 'no', label: 'No', tone: 'alert' },
              ]} />
            </Field>
            <Field label="Reaction">
              <ChipSelect value={reaction} allowClear={false} onChange={(v) => v && setReaction(v)} options={[
                { value: 'none', label: 'Fine', tone: 'calm' }, { value: 'fussy', label: 'Fussy' },
                { value: 'gagged', label: 'Gagged' }, { value: 'vomited', label: 'Vomited', tone: 'alert' },
                { value: 'refused', label: 'Refused' },
              ]} />
            </Field>
            <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
        )}
      </div>

      <div className="field">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox" checked={saveAsDish} onChange={(e) => setSaveAsDish(e.target.checked)}
            style={{ width: 20, height: 20 }}
          />
          Remember as dish
        </label>
        <div className="hint" style={{ margin: '6px 2px 0' }}>Saves this food + ingredients so next time it autofills from the Food box.</div>
      </div>
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
        onSelect={(newCatalogId) => { void handleFoodLookupSelect(newCatalogId); }}
        onClose={() => setLookupUpc(undefined)}
      />
    )}
    {lookupOpen && (
      <FoodLookupSheet
        onSelect={(newCatalogId) => { void handleFoodLookupSelect(newCatalogId); }}
        onClose={() => setLookupOpen(false)}
      />
    )}
    {recipeBuilderOpen && (
      <RecipeBuilderSheet
        editCatalogId={isRecipe ? catalogId : undefined}
        onSave={(newCatalogId) => { void handleRecipeSave(newCatalogId); }}
        onClose={() => setRecipeBuilderOpen(false)}
      />
    )}
    </>
  );
}
