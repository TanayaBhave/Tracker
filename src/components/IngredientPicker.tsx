import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, baseFields } from '../db';

type Props = { value: string[]; onChange: (ids: string[]) => void };

// Chip multi-select over the Ingredient catalog with create-on-the-fly autocomplete.
// Lets a texture/ingredient (e.g. "sweet potato") be tracked as one entity across many meals.
export function IngredientPicker({ value, onChange }: Props) {
  const [text, setText] = useState('');
  const allRaw = useLiveQuery(() => db.ingredients.where('deleted').equals(0).toArray(), []);
  const all = useMemo(() => allRaw ?? [], [allRaw]);
  const byId = useMemo(() => new Map(all.map((i) => [i.id, i])), [all]);

  const query = text.trim().toLowerCase();
  const suggestions = useMemo(
    () => (query ? all.filter((i) => !value.includes(i.id) && i.name.toLowerCase().includes(query)).slice(0, 6) : []),
    [all, value, query],
  );
  const exactMatch = query ? all.some((i) => i.name.toLowerCase() === query) : true;

  // Latest selection, eagerly updated so adds that overlap an in-flight
  // ingredient create chain together instead of clobbering each other.
  const valueRef = useRef(value);
  valueRef.current = value;

  function addId(id: string) {
    const cur = valueRef.current;
    if (cur.includes(id)) return;
    const next = [...cur, id];
    valueRef.current = next;
    onChange(next);
  }

  function select(id: string) {
    addId(id);
    setText('');
  }

  function remove(id: string) {
    onChange(value.filter((v) => v !== id));
  }

  async function createAndSelect(rawName: string) {
    const trimmed = rawName.trim();
    if (!trimmed) return;
    const existing = all.find((i) => i.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) { select(existing.id); return; }
    // Clear the input now, synchronously with the tap — never after the await,
    // where it would wipe whatever the user has started typing next.
    setText('');
    const rec = { ...baseFields(), type: 'ingredient' as const, name: trimmed, tags: [] as string[] };
    await db.ingredients.add(rec);
    addId(rec.id);
  }

  function handleEnter() {
    if (suggestions.length > 0) { select(suggestions[0].id); return; }
    if (query) void createAndSelect(text);
  }

  return (
    <div>
      {value.length > 0 && (
        <div className="choices" style={{ marginBottom: 8 }}>
          {value.map((id) => (
            <button key={id} type="button" className="chip on" onClick={() => remove(id)}>
              {byId.get(id)?.name ?? '…'} ✕
            </button>
          ))}
        </div>
      )}
      <input
        type="text"
        placeholder="Add ingredient…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); handleEnter(); }
        }}
      />
      {query && (
        <div className="choices" style={{ marginTop: 8 }}>
          {suggestions.map((s) => (
            <button key={s.id} type="button" className="chip" onClick={() => select(s.id)}>{s.name}</button>
          ))}
          {!exactMatch && (
            <button type="button" className="chip" onClick={() => void createAndSelect(text)}>
              Add "{text.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  );
}
