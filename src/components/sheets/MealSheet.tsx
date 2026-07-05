import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, baseFields, nowLocalISO, isoToLocal } from '../../db';
import type {
  Meal, FoodItem, MealReaction, Texture, PacePosition, OralMotorTag, Burped,
} from '../../db';
import { Sheet } from '../Sheet';
import { Field, ChipSelect, ChipMulti } from '../Fields';

type Props = { onClose: () => void; editId?: string };
const toISO = (local: string) => new Date(local).toISOString();

export function MealSheet({ onClose, editId }: Props) {
  const [when, setWhen] = useState(nowLocalISO());
  const [foodName, setFoodName] = useState('');
  const [ingredients, setIngredients] = useState('');
  const [category, setCategory] = useState<FoodItem['category']>('puree');
  const [amountGiven, setAmountGiven] = useState('');
  const [amountConsumed, setAmountConsumed] = useState('');
  const [duration, setDuration] = useState('');
  const [texture, setTexture] = useState<Texture>();
  const [pace, setPace] = useState<PacePosition>();
  const [oral, setOral] = useState<OralMotorTag[]>([]);
  const [burped, setBurped] = useState<Burped>();
  const [reaction, setReaction] = useState<MealReaction>('none');
  const [notes, setNotes] = useState('');

  const existing = useLiveQuery(() => editId ? db.meals.get(editId) : undefined, [editId]);

  useEffect(() => {
    if (!existing) return;
    setWhen(isoToLocal(existing.timestamp));
    setFoodName(existing.foodItems[0]?.name ?? '');
    setCategory(existing.foodItems[0]?.category ?? 'puree');
    setAmountGiven(existing.foodItems[0]?.amountGiven?.toString() ?? '');
    setAmountConsumed(existing.foodItems[0]?.amountConsumed?.toString() ?? '');
    setDuration(existing.durationMinutes?.toString() ?? '');
    setTexture(existing.texture);
    setPace(existing.pacePosition);
    setOral(existing.oralMotorTags);
    setBurped(existing.burped);
    setReaction(existing.reaction);
    // Parse "Ingredients: foo, bar — notes" format stored in the notes field
    let rawNotes = existing.notes ?? '';
    let parsedIngredients = '';
    if (rawNotes.startsWith('Ingredients: ')) {
      const afterPrefix = rawNotes.slice('Ingredients: '.length);
      const sepIdx = afterPrefix.indexOf(' — ');
      if (sepIdx !== -1) {
        parsedIngredients = afterPrefix.slice(0, sepIdx);
        rawNotes = afterPrefix.slice(sepIdx + 3);
      } else {
        parsedIngredients = afterPrefix;
        rawNotes = '';
      }
    }
    setIngredients(parsedIngredients);
    setNotes(rawNotes);
  }, [existing]);

  async function save() {
    const item: FoodItem = {
      name: foodName.trim() || 'Meal',
      category,
      amountGiven: amountGiven ? Number(amountGiven) : undefined,
      amountConsumed: amountConsumed ? Number(amountConsumed) : undefined,
      unit: category === 'liquid' || category === 'formula' || category === 'breastmilk' ? 'ml' : 'g',
      ingredientIds: [],
    };
    const fields: Partial<Meal> = {
      timestamp: toISO(when),
      durationMinutes: duration ? Number(duration) : undefined,
      foodItems: [item],
      texture, pacePosition: pace, oralMotorTags: oral, burped, reaction,
      notes: [ingredients && `Ingredients: ${ingredients}`, notes].filter(Boolean).join(' — ') || undefined,
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
    <Sheet
      title={editId ? 'Edit meal' : 'Add meal'}
      onClose={onClose} onSave={save}
      onDelete={editId ? handleDelete : undefined}
    >
      <Field label="Time"><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
      <Field label="Food"><input type="text" placeholder="e.g. Sweet potato puree" value={foodName} onChange={(e) => setFoodName(e.target.value)} /></Field>
      <Field label="Ingredients" hint="Comma-separated. Lets you spot a single ingredient across meals later."><input type="text" placeholder="sweet potato, olive oil" value={ingredients} onChange={(e) => setIngredients(e.target.value)} /></Field>
      <Field label="Category">
        <ChipSelect value={category} allowClear={false} onChange={(v) => v && setCategory(v)} options={[
          { value: 'puree', label: 'Purée' }, { value: 'solid', label: 'Solid' },
          { value: 'finger-food', label: 'Finger' }, { value: 'liquid', label: 'Liquid' },
          { value: 'formula', label: 'Formula' }, { value: 'breastmilk', label: 'Breastmilk' },
          { value: 'other', label: 'Other' },
        ]} />
      </Field>
      <Field label="Texture" hint="A suspected trigger — worth tagging.">
        <ChipSelect value={texture} onChange={setTexture} options={[
          { value: 'smooth-puree', label: 'Smooth' }, { value: 'mashed', label: 'Mashed' },
          { value: 'lumpy', label: 'Lumpy' }, { value: 'soft-solid', label: 'Soft solid' },
          { value: 'hard-solid', label: 'Hard solid' }, { value: 'mixed', label: 'Mixed' },
        ]} />
      </Field>
      <div style={{ display: 'flex', gap: 10 }}>
        <Field label="Given"><input type="number" inputMode="decimal" value={amountGiven} onChange={(e) => setAmountGiven(e.target.value)} /></Field>
        <Field label="Eaten"><input type="number" inputMode="decimal" value={amountConsumed} onChange={(e) => setAmountConsumed(e.target.value)} /></Field>
        <Field label="Mins"><input type="number" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} /></Field>
      </div>
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
    </Sheet>
  );
}
