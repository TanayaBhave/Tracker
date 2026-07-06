// USDA search -> FoodCatalogItem sheet (workstream W4, Phase 3). Opened either
// with a `upc` (from BarcodeScanner) for a fast auto-resolve path, or on its
// own for a manual name search from MealSheet's Scan button flow.
import { useEffect, useRef, useState } from 'react';
import { db, baseFields } from '../db';
import type { FoodCatalogItem } from '../db';
import { searchUSDA, getUsdaFood, lookupByUpc } from '../nutrition/usdaClient';
import type { UsdaSearchHit, NormalizedUsdaFood } from '../nutrition/usdaClient';

type Props = { upc?: string; onSelect: (catalogId: string) => void; onClose: () => void };

/** Upserts a FoodCatalogItem from a normalized USDA food, reusing an existing
 *  catalog entry with the same fdcId/upc (so re-scanning the same product
 *  updates it instead of creating a duplicate). Returns the catalog item id. */
async function upsertCatalogFromUsda(food: NormalizedUsdaFood): Promise<string> {
  const now = new Date().toISOString();
  const existing = food.fdcId
    ? await db.foodCatalog.where('fdcId').equals(food.fdcId).first()
    : (food.upc ? await db.foodCatalog.where('upc').equals(food.upc).first() : undefined);

  const fields = {
    name: food.name,
    brand: food.brand,
    upc: food.upc,
    fdcId: food.fdcId || undefined,
    per100: food.per100,
    servingGrams: food.servingGrams,
    nutritionSource: 'usda' as const,
    lastFetchedAt: now,
    updatedAt: now,
  };

  if (existing) {
    await db.foodCatalog.put({ ...existing, ...fields });
    return existing.id;
  }
  const rec: FoodCatalogItem = {
    ...baseFields(),
    type: 'foodCatalog',
    category: 'other',
    defaultUnit: 'g',
    ingredientIds: [],
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
  const autoTriedRef = useRef(false);

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
            <div className="hint" style={{ margin: '0 2px 14px' }}>
              No USDA match for UPC {upc}. Try searching by name below.
            </div>
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

              {status === 'error' && errorMsg && (
                <div className="warn-banner" style={{ marginTop: 14 }}>{errorMsg}</div>
              )}

              {results.length > 0 && (
                <div style={{ marginTop: 16 }}>
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
  );
}
