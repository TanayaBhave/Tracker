// USDA search -> FoodCatalogItem sheet (workstream W4, Phase 3). Opened either
// with a `upc` (from BarcodeScanner) for a fast auto-resolve path, or on its
// own for a manual name search from MealSheet's Scan button flow.
import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, baseFields } from '../db';
import type { FoodCatalogItem } from '../db';
import { searchUSDA, getUsdaFood, lookupByUpc } from '../nutrition/usdaClient';
import type { UsdaSearchHit, NormalizedUsdaFood } from '../nutrition/usdaClient';
import { cleanProductName } from '../nutrition/productName';
import { reblendDependents } from '../nutrition/cascade';
import { ManualNutritionSheet } from './ManualNutritionSheet';

type Props = { upc?: string; onSelect: (catalogId: string) => void; onClose: () => void };

/** Same badge text as CatalogManagerSheet.tsx's sourceLabel — duplicated
 *  rather than imported, matching this codebase's established convention of
 *  keeping small, stable per-sheet helpers local (see ManualNutritionSheet.tsx's
 *  NUTRIENT_FIELDS comment for the same reasoning). */
function sourceLabel(source: FoodCatalogItem['nutritionSource']): string {
  switch (source) {
    case 'recipe': return 'Recipe';
    case 'usda': return 'USDA';
    case 'manual': return 'Manual';
    default: return 'No data';
  }
}

/** Find-or-create an Ingredient record for a scanned/searched product so the
 *  ingredient-level vomit-correlation engine (and recipes' ingredientIds
 *  union) can see it — a catalog item with per100 but no Ingredient link is
 *  invisible to both. Case-insensitive name match against db.ingredients;
 *  the name is cleaned first (see productName.ts) so "365 ORGANIC TAHINI
 *  16OZ" and a re-scan of the same jar converge on one "Organic Tahini". */
export async function findOrCreateIngredient(rawName: string, brand?: string): Promise<string> {
  const name = cleanProductName(rawName, brand);
  const lower = name.toLowerCase();
  const existing = (await db.ingredients.where('deleted').equals(0).toArray())
    .find((i) => i.name.toLowerCase() === lower);
  if (existing) return existing.id;
  const rec = { ...baseFields(), type: 'ingredient' as const, name, tags: [] as string[] };
  await db.ingredients.add(rec);
  return rec.id;
}

/** Upserts a FoodCatalogItem from a normalized USDA food, reusing an existing
 *  catalog entry with the same fdcId/upc (so re-scanning the same product
 *  updates it instead of creating a duplicate). Returns the catalog item id. */
async function upsertCatalogFromUsda(food: NormalizedUsdaFood): Promise<string> {
  const now = new Date().toISOString();
  const existing = food.fdcId
    ? await db.foodCatalog.where('fdcId').equals(food.fdcId).first()
    : (food.upc ? await db.foodCatalog.where('upc').equals(food.upc).first() : undefined);

  // Applies to scanned AND name-searched products (both paths land here):
  // if the item isn't linked to any Ingredient yet, link it to one now.
  const ingredientIds = existing && existing.ingredientIds.length > 0
    ? existing.ingredientIds
    : [await findOrCreateIngredient(food.name, food.brand)];

  const fields = {
    name: food.name,
    brand: food.brand,
    upc: food.upc,
    fdcId: food.fdcId || undefined,
    per100: food.per100,
    servingGrams: food.servingGrams,
    nutritionSource: 'usda' as const,
    lastFetchedAt: now,
    ingredientIds,
    updatedAt: now,
  };

  if (existing) {
    await db.foodCatalog.put({ ...existing, ...fields });
    // Re-scanning an already-catalogued product can change its per100 if
    // USDA's data changed since the last scan — fix any recipe that uses
    // this item as a component right away.
    await reblendDependents([existing.id]);
    return existing.id;
  }
  const rec: FoodCatalogItem = {
    ...baseFields(),
    type: 'foodCatalog',
    category: 'other',
    defaultUnit: 'g',
    ...fields,
  };
  await db.foodCatalog.add(rec);
  return rec.id;
}

export function FoodLookupSheet({ upc, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UsdaSearchHit[]>([]);
  const [status, setStatus] = useState<'idle' | 'resolving-upc' | 'searching' | 'saving' | 'upc-not-found' | 'error'>(
    upc ? 'resolving-upc' : 'idle',
  );
  const [errorMsg, setErrorMsg] = useState<string>();
  // Phase 3.5 fallback: type the nutrition facts off the physical label when
  // USDA has no match (see ManualNutritionSheet.tsx).
  const [manualOpen, setManualOpen] = useState(false);
  const autoTriedRef = useRef(false);

  // Live, offline, no-network-call match against everything already in this
  // device's catalog (manual entries, past USDA picks, saved recipes) — the
  // gap this fixes: search used to hit USDA only, so an ingredient you'd
  // already hand-entered once could never be found again by searching, only
  // by re-entering it from scratch. Requires 2+ chars so a near-empty query
  // doesn't dump the whole catalog.
  const localMatches = useLiveQuery(async () => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const all = await db.foodCatalog.where('deleted').equals(0).toArray();
    return all
      .filter((item) => item.name.toLowerCase().includes(q) || (item.brand ?? '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [query]) ?? [];

  // Fast path: a scanned UPC tries to resolve straight to a catalog item
  // without making the user search by name at all.
  useEffect(() => {
    if (!upc || autoTriedRef.current) return;
    autoTriedRef.current = true;
    (async () => {
      try {
        const hit = await lookupByUpc(upc);
        if (hit) {
          const id = await upsertCatalogFromUsda(hit);
          onSelect(id);
          return;
        }
        setStatus('upc-not-found');
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    })();
    // onSelect intentionally excluded: this effect must run exactly once per
    // scanned UPC, not re-fire if the parent passes a new onSelect closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upc]);

  async function runSearch() {
    const q = query.trim();
    if (!q) return;
    setStatus('searching');
    setErrorMsg(undefined);
    try {
      setResults(await searchUSDA(q));
      setStatus('idle');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }

  async function pick(hit: UsdaSearchHit) {
    setStatus('saving');
    setErrorMsg(undefined);
    try {
      const food = await getUsdaFood(hit.fdcId);
      const id = await upsertCatalogFromUsda(food);
      onSelect(id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }

  return (
    <>
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grip" />
        <div className="sheet-header">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <h2>Find food</h2>
          <span style={{ width: 46 }} />
        </div>
        <div className="sheet-body">
          {status === 'resolving-upc' && (
            <div className="empty">Looking up UPC {upc}…</div>
          )}
          {status === 'upc-not-found' && (
            <>
              <div className="hint" style={{ margin: '0 2px 14px' }}>
                No USDA match for UPC {upc}. Try searching by name below, or enter the nutrition facts straight off the label.
              </div>
              <div className="sheet-actions" style={{ marginBottom: 14 }}>
                <button type="button" className="btn save" onClick={() => setManualOpen(true)}>
                  Enter nutrition from the label
                </button>
              </div>
            </>
          )}
          {status !== 'resolving-upc' && (
            <>
              <div className="field">
                <label>Search USDA FoodData Central</label>
                <input
                  type="text"
                  placeholder="e.g. sweet potato, whole milk yogurt"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void runSearch(); } }}
                />
              </div>
              <div className="sheet-actions">
                <button type="button" className="btn save" onClick={() => void runSearch()} disabled={status === 'searching'}>
                  {status === 'searching' ? 'Searching…' : 'Search'}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setManualOpen(true)}
                style={{
                  display: 'block', margin: '10px auto 0', background: 'none', border: 'none',
                  color: 'var(--accent)', fontSize: 13, fontWeight: 600, textDecoration: 'underline',
                }}
              >
                Can't find it? Enter from the label
              </button>

              {status === 'error' && errorMsg && (
                <div className="warn-banner" style={{ marginTop: 14 }}>{errorMsg}</div>
              )}

              {localMatches.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div className="section-label" style={{ margin: '0 0 8px' }}>Already in your catalog</div>
                  {localMatches.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="entry"
                      style={{ width: '100%', textAlign: 'left', background: 'none', borderBottom: '1px solid var(--line-soft)' }}
                      onClick={() => onSelect(item.id)}
                      disabled={status === 'saving'}
                    >
                      <div className="body">
                        <div className="title">
                          {item.name}{' '}
                          <span style={{
                            display: 'inline-block', fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)',
                            background: 'var(--chip-idle)', borderRadius: 999, padding: '2px 8px', marginLeft: 4,
                          }}
                          >
                            {sourceLabel(item.nutritionSource)}
                          </span>
                        </div>
                        {item.brand && <div className="meta">{item.brand}</div>}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {results.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  {localMatches.length > 0 && (
                    <div className="section-label" style={{ margin: '0 0 8px' }}>USDA search results</div>
                  )}
                  {results.map((r) => (
                    <button
                      key={r.fdcId}
                      type="button"
                      className="entry"
                      style={{ width: '100%', textAlign: 'left', background: 'none', borderBottom: '1px solid var(--line-soft)' }}
                      onClick={() => void pick(r)}
                      disabled={status === 'saving'}
                    >
                      <div className="body">
                        <div className="title">{r.description}</div>
                        {r.brand && <div className="meta">{r.brand}</div>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {status === 'saving' && <div className="hint" style={{ margin: '14px 2px 0' }}>Saving…</div>}
            </>
          )}
        </div>
      </div>
    </div>
    {manualOpen && (
      <ManualNutritionSheet
        upc={upc}
        initialName={query.trim() || undefined}
        onSelect={(id) => { setManualOpen(false); onSelect(id); }}
        onClose={() => setManualOpen(false)}
      />
    )}
    </>
  );
}
