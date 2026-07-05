import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, baseFields, nowLocalISO, isoToLocal, todayStr } from '../db';
import type {
  Meal, FoodItem, MealReaction, Texture, PacePosition, OralMotorTag, Burped,
  VomitSeverity, VomitAppearance, VomitForce, BodyPosition,
  StoolConsistency, ThreeLevel,
} from '../db';
import { Sheet } from './Sheet';
import { Field, ChipSelect, ChipMulti } from './Fields';

type Props = { onClose: () => void; editId?: string };
const toISO = (local: string) => new Date(local).toISOString();

// ---------- MEAL ----------
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

// ---------- VOMIT ----------
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

// ---------- STOOL ----------
export function StoolSheet({ onClose, editId }: Props) {
  const [when, setWhen] = useState(nowLocalISO());
  const [consistency, setConsistency] = useState<StoolConsistency>('soft');
  const [straining, setStraining] = useState(false);
  const [notes, setNotes] = useState('');

  const existing = useLiveQuery(() => editId ? db.stools.get(editId) : undefined, [editId]);

  useEffect(() => {
    if (!existing) return;
    setWhen(isoToLocal(existing.timestamp));
    setConsistency(existing.consistency);
    setStraining(existing.straining === 1);
    setNotes(existing.notes ?? '');
  }, [existing]);

  async function save() {
    const fields = {
      timestamp: toISO(when),
      consistency, straining: straining ? 1 as const : 0 as const,
      notes: notes || undefined,
      updatedAt: new Date().toISOString(),
    };
    if (editId && existing) {
      await db.stools.put({ ...existing, ...fields });
    } else {
      await db.stools.add({ ...baseFields(), type: 'stool', ...fields });
    }
    onClose();
  }

  async function handleDelete() {
    if (!editId || !window.confirm('Delete this nappy entry?')) return;
    await db.stools.update(editId, { deleted: 1, updatedAt: new Date().toISOString() });
    onClose();
  }

  return (
    <Sheet
      title={editId ? 'Edit nappy' : 'Log nappy / stool'}
      onClose={onClose} onSave={save}
      onDelete={editId ? handleDelete : undefined}
    >
      <Field label="Time"><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
      <Field label="Consistency">
        <ChipSelect value={consistency} allowClear={false} onChange={(v) => v && setConsistency(v)} options={[
          { value: 'hard', label: 'Hard' }, { value: 'formed', label: 'Formed' },
          { value: 'soft', label: 'Soft', tone: 'calm' }, { value: 'loose', label: 'Loose' },
          { value: 'watery', label: 'Watery' },
        ]} />
      </Field>
      <Field label="Straining?">
        <ChipSelect value={straining ? 'y' : undefined} onChange={(v) => setStraining(v === 'y')} options={[{ value: 'y', label: 'Strained', tone: 'alert' }]} />
      </Field>
      <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Sheet>
  );
}

// ---------- MED ----------
export function MedSheet({ onClose, editId }: Props) {
  const [when, setWhen] = useState(nowLocalISO());
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('ml');
  const [notes, setNotes] = useState('');

  const existing = useLiveQuery(() => editId ? db.meds.get(editId) : undefined, [editId]);

  useEffect(() => {
    if (!existing) return;
    setWhen(isoToLocal(existing.timestamp));
    setName(existing.medName);
    setAmount(existing.doseAmount?.toString() ?? '');
    setUnit(existing.doseUnit ?? 'ml');
    setNotes(existing.notes ?? '');
  }, [existing]);

  async function save() {
    const fields = {
      timestamp: toISO(when),
      medName: name.trim() || 'Medication',
      doseAmount: amount ? Number(amount) : undefined,
      doseUnit: unit,
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
    <Sheet
      title={editId ? 'Edit medication' : 'Log medication'}
      onClose={onClose} onSave={save}
      onDelete={editId ? handleDelete : undefined}
    >
      <Field label="Time"><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
      <Field label="Medication"><input type="text" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div style={{ display: 'flex', gap: 10 }}>
        <Field label="Dose"><input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Unit"><input type="text" value={unit} onChange={(e) => setUnit(e.target.value)} /></Field>
      </div>
      <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Sheet>
  );
}

// ---------- DAILY: gassiness + activity (three-level) ----------
function ThreeLevelSheet({ onClose, kind }: { onClose: () => void; kind: 'gas' | 'activity' }) {
  const [date, setDate] = useState(todayStr());
  const [level, setLevel] = useState<ThreeLevel>('regular');
  const [notes, setNotes] = useState('');
  const title = kind === 'gas' ? 'Gassiness today' : 'Activity today';
  async function save() {
    const base = { ...baseFields(), date, level, notes: notes || undefined };
    if (kind === 'gas') await db.gassiness.add({ ...base, type: 'gas' });
    else await db.activity.add({ ...base, type: 'activity' });
    onClose();
  }
  return (
    <Sheet title={title} onClose={onClose} onSave={save}>
      <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Level">
        <ChipSelect value={level} allowClear={false} onChange={(v) => v && setLevel(v)} options={[
          { value: 'less', label: 'Less', tone: 'calm' }, { value: 'regular', label: 'Regular' }, { value: 'more', label: 'More', tone: 'alert' },
        ]} />
      </Field>
      <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Sheet>
  );
}
export const GasSheet = (p: { onClose: () => void }) => <ThreeLevelSheet {...p} kind="gas" />;
export const ActivitySheet = (p: { onClose: () => void }) => <ThreeLevelSheet {...p} kind="activity" />;

// ---------- SLEEP ----------
export function SleepSheet({ onClose, editId }: Props) {
  const [start, setStart] = useState(nowLocalISO());
  const [end, setEnd] = useState('');
  const [quality, setQuality] = useState<'good' | 'restless' | 'poor'>();
  const [notes, setNotes] = useState('');

  const existing = useLiveQuery(() => editId ? db.sleep.get(editId) : undefined, [editId]);

  useEffect(() => {
    if (!existing) return;
    setStart(isoToLocal(existing.startTime));
    setEnd(existing.endTime ? isoToLocal(existing.endTime) : '');
    setQuality(existing.quality);
    setNotes(existing.notes ?? '');
  }, [existing]);

  async function save() {
    const fields = {
      startTime: toISO(start),
      endTime: end ? toISO(end) : undefined,
      quality,
      notes: notes || undefined,
      updatedAt: new Date().toISOString(),
    };
    if (editId && existing) {
      await db.sleep.put({ ...existing, ...fields });
    } else {
      await db.sleep.add({ ...baseFields(), type: 'sleep', ...fields });
    }
    onClose();
  }

  async function handleDelete() {
    if (!editId || !window.confirm('Delete this sleep entry?')) return;
    await db.sleep.update(editId, { deleted: 1, updatedAt: new Date().toISOString() });
    onClose();
  }

  return (
    <Sheet
      title={editId ? 'Edit sleep' : 'Log sleep'}
      onClose={onClose} onSave={save}
      onDelete={editId ? handleDelete : undefined}
    >
      <Field label="Start"><input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
      <Field label="End" hint="Leave blank if still sleeping."><input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      <Field label="Quality">
        <ChipSelect value={quality} onChange={setQuality} options={[
          { value: 'good', label: 'Good', tone: 'calm' }, { value: 'restless', label: 'Restless' }, { value: 'poor', label: 'Poor', tone: 'alert' },
        ]} />
      </Field>
      <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Sheet>
  );
}

// ---------- WEIGHT ----------
export function WeightSheet({ onClose }: { onClose: () => void }) {
  const [date, setDate] = useState(todayStr());
  const [weight, setWeight] = useState('');
  const [unit, setUnit] = useState<'kg' | 'lb'>('kg');
  const [notes, setNotes] = useState('');
  async function save() {
    if (!weight) return onClose();
    await db.weights.add({
      ...baseFields(), type: 'weight', date, weight: Number(weight), unit, notes: notes || undefined,
    });
    onClose();
  }
  return (
    <Sheet title="Log weight" onClose={onClose} onSave={save}>
      <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <div style={{ display: 'flex', gap: 10 }}>
        <Field label="Weight"><input type="number" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} /></Field>
        <Field label="Unit">
          <ChipSelect value={unit} allowClear={false} onChange={(v) => v && setUnit(v)} options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]} />
        </Field>
      </div>
      <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Sheet>
  );
}

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
