// Manage the two "delete-adjacent" catalogs from one screen: db.foodCatalog
// (plain foods + recipes) and db.ingredients (the free-form ingredient-tag
// catalog used for correlation). A list/management screen, not a single-record
// edit form, so it builds its own sheet-backdrop/sheet markup (like
// FoodLookupSheet) instead of using the single-save-button <Sheet> wrapper —
// each row's Edit/Delete/Rename/Merge action saves independently.
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { FoodCatalogItem, Ingredient } from '../db';
import { countFoodCatalogRefs, countIngredientRefs, mergeIngredients } from '../nutrition/references';
import { ChipSelect } from './Fields';
import { RecipeBuilderSheet } from './RecipeBuilderSheet';
import { ManualNutritionSheet } from './ManualNutritionSheet';

type Props = { onClose: () => void };

type Tab = 'food' | 'tags';

function sourceLabel(source: FoodCatalogItem['nutritionSource']): string {
  switch (source) {
    case 'recipe': return 'Recipe';
    case 'usda': return 'USDA';
    case 'manual': return 'Manual';
    default: return 'No data';
  }
}

function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Builds the "Can't delete — used in X and Y" message, omitting whichever
 *  clause is zero so a food used only in meals doesn't say "and 0 recipes". */
function blockedMessage(counts: { a: number; b: number }, aWord: string, bWord: string): string {
  const parts: string[] = [];
  if (counts.a > 0) parts.push(pluralize(counts.a, aWord));
  if (counts.b > 0) parts.push(pluralize(counts.b, bWord));
  return `Can't delete — used in ${parts.join(' and ')}. Remove it from those first.`;
}

export function CatalogManagerSheet({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>('food');
  const [filter, setFilter] = useState('');

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grip" />
        <div className="sheet-header">
          <button type="button" className="btn ghost" onClick={onClose}>Close</button>
          <h2>Manage foods & ingredients</h2>
          <span style={{ width: 46 }} />
        </div>
        <div className="sheet-body">
          <div className="field">
            <ChipSelect
              value={tab}
              allowClear={false}
              onChange={(v) => { if (v) { setTab(v); setFilter(''); } }}
              options={[
                { value: 'food', label: 'Foods & recipes' },
                { value: 'tags', label: 'Ingredient tags' },
              ]}
            />
          </div>
          <div className="field">
            <input
              type="text"
              placeholder="Filter by name…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          {tab === 'food' ? <FoodTab filter={filter} /> : <TagsTab filter={filter} />}
        </div>
      </div>
    </div>
  );
}

function FoodTab({ filter }: { filter: string }) {
  const items = useLiveQuery(() => db.foodCatalog.where('deleted').equals(0).toArray(), []);
  const [editingId, setEditingId] = useState<string>();
  const [creatingRecipe, setCreatingRecipe] = useState(false);
  const [blocked, setBlocked] = useState<Record<string, string>>({});

  const sorted = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (items ?? [])
      .filter((f) => !q || f.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items, filter]);

  async function handleDelete(row: FoodCatalogItem) {
    const { meals, recipes } = await countFoodCatalogRefs(row.id);
    if (meals + recipes > 0) {
      setBlocked((b) => ({ ...b, [row.id]: blockedMessage({ a: meals, b: recipes }, 'meal', 'recipe') }));
      return;
    }
    setBlocked((b) => { const next = { ...b }; delete next[row.id]; return next; });
    await db.foodCatalog.put({ ...row, deleted: 1, updatedAt: new Date().toISOString() });
  }

  const editingRow = editingId ? (items ?? []).find((f) => f.id === editingId) : undefined;

  return (
    <>
      <div className="sheet-actions" style={{ marginBottom: 12 }}>
        <button type="button" className="btn ghost" onClick={() => setCreatingRecipe(true)}>+ New recipe</button>
      </div>
      {sorted.length === 0 && <div className="empty">No foods match.</div>}
      {sorted.map((row) => (
        <div key={row.id} className="entry" style={{ padding: '11px 4px' }}>
          <div className="body">
            <div className="title">
              {row.name}{' '}
              <span style={{
                display: 'inline-block', fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)',
                background: 'var(--chip-idle)', borderRadius: 999, padding: '2px 8px', marginLeft: 4,
              }}
              >
                {sourceLabel(row.nutritionSource)}
              </span>
            </div>
            {row.brand && <div className="meta">{row.brand}</div>}
            {blocked[row.id] && <div className="warn-banner" style={{ marginTop: 8, marginBottom: 0 }}>{blocked[row.id]}</div>}
            <div className="choices" style={{ marginTop: 8 }}>
              <button type="button" className="chip" onClick={() => setEditingId(row.id)}>Edit</button>
              <button type="button" className="chip" onClick={() => { void handleDelete(row); }}>Delete</button>
            </div>
          </div>
        </div>
      ))}
      {editingRow && editingRow.nutritionSource === 'recipe' && (
        <RecipeBuilderSheet
          editCatalogId={editingRow.id}
          onSave={() => setEditingId(undefined)}
          onClose={() => setEditingId(undefined)}
        />
      )}
      {editingRow && editingRow.nutritionSource !== 'recipe' && (
        <ManualNutritionSheet
          editCatalogId={editingRow.id}
          onSelect={() => setEditingId(undefined)}
          onClose={() => setEditingId(undefined)}
        />
      )}
      {creatingRecipe && (
        <RecipeBuilderSheet
          onSave={() => setCreatingRecipe(false)}
          onClose={() => setCreatingRecipe(false)}
        />
      )}
    </>
  );
}

function TagsTab({ filter }: { filter: string }) {
  const items = useLiveQuery(() => db.ingredients.where('deleted').equals(0).toArray(), []);
  const [blocked, setBlocked] = useState<Record<string, string>>({});
  const [renamingId, setRenamingId] = useState<string>();
  const [renameText, setRenameText] = useState('');
  const [renameMsg, setRenameMsg] = useState<Record<string, string>>({});
  const [mergingId, setMergingId] = useState<string>();
  const [mergeSearch, setMergeSearch] = useState('');

  const all = useMemo(() => items ?? [], [items]);
  const sorted = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return all
      .filter((i) => !q || i.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [all, filter]);

  async function handleDelete(row: Ingredient) {
    const { meals, catalogItems } = await countIngredientRefs(row.id);
    if (meals + catalogItems > 0) {
      setBlocked((b) => ({ ...b, [row.id]: blockedMessage({ a: meals, b: catalogItems }, 'meal', 'saved food') }));
      return;
    }
    setBlocked((b) => { const next = { ...b }; delete next[row.id]; return next; });
    await db.ingredients.put({ ...row, deleted: 1, updatedAt: new Date().toISOString() });
  }

  function startRename(row: Ingredient) {
    setRenamingId(row.id);
    setRenameText(row.name);
    setRenameMsg((m) => { const next = { ...m }; delete next[row.id]; return next; });
  }

  async function saveRename(row: Ingredient) {
    const trimmed = renameText.trim();
    if (!trimmed) return;
    const collision = all.find((i) => i.id !== row.id && i.name.toLowerCase() === trimmed.toLowerCase());
    if (collision) {
      setRenameMsg((m) => ({ ...m, [row.id]: `"${collision.name}" already exists — use Merge into… instead.` }));
      return;
    }
    await db.ingredients.put({ ...row, name: trimmed, updatedAt: new Date().toISOString() });
    setRenamingId(undefined);
  }

  async function pickMergeSurvivor(loserId: string, survivorId: string) {
    await mergeIngredients(loserId, survivorId);
    setMergingId(undefined);
    setMergeSearch('');
  }

  const mergeCandidates = useMemo(() => {
    if (!mergingId) return [];
    const q = mergeSearch.trim().toLowerCase();
    return all
      .filter((i) => i.id !== mergingId && (!q || i.name.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 20);
  }, [all, mergingId, mergeSearch]);

  return (
    <>
      {sorted.length === 0 && <div className="empty">No ingredients match.</div>}
      {sorted.map((row) => (
        <div key={row.id} className="entry" style={{ padding: '11px 4px' }}>
          <div className="body">
            {renamingId === row.id ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="text" value={renameText} style={{ flex: 1 }}
                  onChange={(e) => setRenameText(e.target.value)}
                />
                <button type="button" className="chip" onClick={() => { void saveRename(row); }}>Save</button>
                <button type="button" className="chip" onClick={() => setRenamingId(undefined)}>Cancel</button>
              </div>
            ) : (
              <div className="title">{row.name}</div>
            )}
            {row.tags.length > 0 && <div className="meta">{row.tags.join(', ')}</div>}
            {renameMsg[row.id] && <div className="warn-banner" style={{ marginTop: 8, marginBottom: 0 }}>{renameMsg[row.id]}</div>}
            {blocked[row.id] && <div className="warn-banner" style={{ marginTop: 8, marginBottom: 0 }}>{blocked[row.id]}</div>}
            {mergingId === row.id && (
              <div style={{ marginTop: 8, padding: 10, border: '1px solid var(--line)', borderRadius: 'var(--r)' }}>
                <input
                  type="text" placeholder="Search ingredient to merge into…"
                  value={mergeSearch} onChange={(e) => setMergeSearch(e.target.value)}
                  style={{ marginBottom: 8 }}
                />
                <div className="choices">
                  {mergeCandidates.map((c) => (
                    <button key={c.id} type="button" className="chip" onClick={() => { void pickMergeSurvivor(row.id, c.id); }}>
                      {c.name}
                    </button>
                  ))}
                  {mergeCandidates.length === 0 && <div className="hint" style={{ margin: 0 }}>No matches.</div>}
                </div>
                <button
                  type="button" className="btn ghost" style={{ marginTop: 8, minHeight: 'auto', padding: '8px 12px' }}
                  onClick={() => { setMergingId(undefined); setMergeSearch(''); }}
                >
                  Cancel
                </button>
              </div>
            )}
            {renamingId !== row.id && mergingId !== row.id && (
              <div className="choices" style={{ marginTop: 8 }}>
                <button type="button" className="chip" onClick={() => startRename(row)}>Rename</button>
                <button type="button" className="chip" onClick={() => { setMergingId(row.id); setMergeSearch(''); }}>Merge into…</button>
                <button type="button" className="chip" onClick={() => { void handleDelete(row); }}>Delete</button>
              </div>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
