// Supplement lookup -> MedCatalogItem sheet. Opened either with a `upc` (from
// BarcodeScanner, e.g. a vitamin-D-drops bottle) for a fast auto-resolve path,
// or on its own for a name search — mirroring FoodLookupSheet's contract.
//
// Lookup order: local med catalog (offline repeat-scan) -> NIH DSLD (the
// authoritative supplement label source; USDA FDC excludes supplements) ->
// USDA FDC (a few supplements do appear there as Branded foods). A hit lands
// in a small confirm state (name / brand / nutrient count) before anything is
// written; a miss falls back to name search, never an error wall.
import { useEffect, useRef, useState } from 'react';
import { db, baseFields } from '../db';
import type { MedCatalogItem, NutrientProfile } from '../db';
import {
  searchDsld, getDsldLabel, normalizeDsldLabel, lookupSupplementByUpc,
} from '../nutrition/dsldClient';
import type { NormalizedDsldSupplement } from '../nutrition/dsldClient';
import { searchUSDA, getUsdaFood, lookupByUpc } from '../nutrition/usdaClient';
import type { NormalizedUsdaFood } from '../nutrition/usdaClient';

type Props = { upc?: string; onSelect: (catalogId: string) => void; onClose: () => void };

type LookupHit = {
  key: string;
  name: string;
  brand?: string;
  source: 'dsld' | 'usda';
  dsldId?: string;
  fdcId?: number;
  offMarket?: boolean;
};

/** USDA branded "supplement" -> the DSLD-normalized shape. FDC nutrition is
 *  per-100g while a supplement dose is one serving, so perDose can only be
 *  derived when FDC declares the serving size in g/ml (perDose = per100 x
 *  servingGrams / 100); otherwise the name/brand/upc still prefill but no
 *  nutrients are attached — never guessed from an unknown serving. */
function supplementFromUsda(food: NormalizedUsdaFood): NormalizedDsldSupplement {
  const perDose: NutrientProfile = {};
  if (food.servingGrams) {
    for (const [key, value] of Object.entries(food.per100)) {
      if (typeof value === 'number') {
        perDose[key as keyof NutrientProfile] = value * food.servingGrams / 100;
      }
    }
  }
  return {
    name: food.name,
    brand: food.brand,
    upc: food.upc,
    perDose,
    defaultDoseAmount: food.servingGrams,
    defaultDoseUnit: food.servingGrams ? 'g' : undefined,
  };
}

function nutrientCount(perDose: NutrientProfile): number {
  return Object.values(perDose).filter((v) => typeof v === 'number').length;
}

/** Creates/updates a MedCatalogItem (kind 'supplement') from a normalized
 *  label, matching an existing entry by UPC first, then by case-insensitive
 *  name, so a re-scan updates instead of duplicating. Returns the item id. */
async function upsertMedCatalogFromSupplement(s: NormalizedDsldSupplement): Promise<string> {
  const now = new Date().toISOString();
  const all = await db.medCatalog.where('deleted').equals(0).toArray();
  const existing = (s.upc ? all.find((m) => m.upc === s.upc) : undefined)
    ?? all.find((m) => m.name.toLowerCase() === s.name.toLowerCase());

  const fields = {
    name: s.name,
    kind: 'supplement' as const,
    brand: s.brand,
    upc: s.upc,
    defaultDoseAmount: s.defaultDoseAmount,
    defaultDoseUnit: s.defaultDoseUnit,
    perDose: nutrientCount(s.perDose) > 0 ? s.perDose : undefined,
    updatedAt: now,
  };

  if (existing) {
    await db.medCatalog.put({ ...existing, ...fields });
    return existing.id;
  }
  const rec: MedCatalogItem = { ...baseFields(), type: 'medCatalog', archived: 0, ...fields };
  await db.medCatalog.add(rec);
  return rec.id;
}

export function MedLookupSheet({ upc, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LookupHit[]>([]);
  const [pending, setPending] = useState<{ supplement: NormalizedDsldSupplement; source: string }>();
  const [status, setStatus] = useState<'idle' | 'resolving-upc' | 'searching' | 'saving' | 'confirm' | 'upc-not-found' | 'error'>(
    upc ? 'resolving-upc' : 'idle',
  );
  const [errorMsg, setErrorMsg] = useState<string>();
  const autoTriedRef = useRef(false);

  useEffect(() => {
    if (!upc || autoTriedRef.current) return;
    autoTriedRef.current = true;
    (async () => {
      try {
        // DSLD first (supplements are its whole job), then USDA as some
        // supplements appear there as Branded foods.
        const hit = await lookupSupplementByUpc(upc);
        if (hit?.source === 'local') {
          onSelect(hit.catalogId);
          return;
        }
        if (hit?.source === 'dsld') {
          setPending({ supplement: hit.supplement, source: 'NIH DSLD' });
          setStatus('confirm');
          return;
        }
        const usdaHit = await lookupByUpc(upc);
        if (usdaHit) {
          setPending({ supplement: supplementFromUsda(usdaHit), source: 'USDA' });
          setStatus('confirm');
          return;
        }
        setStatus('upc-not-found');
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    })();
    // onSelect intentionally excluded: run exactly once per scanned UPC (same
    // pattern and reasoning as FoodLookupSheet).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upc]);

  async function runSearch() {
    const q = query.trim();
    if (!q) return;
    setStatus('searching');
    setErrorMsg(undefined);
    try {
      // DSLD is primary; USDA results are appended as a fallback so a
      // supplement missing from DSLD can still be found by name.
      const dsldHits = (await searchDsld(q)).slice(0, 8).map((h): LookupHit => ({
        key: `dsld:${h.id}`, name: h.name, brand: h.brand, source: 'dsld', dsldId: h.id,
        offMarket: h.offMarket === 1,
      }));
      let usdaHits: LookupHit[] = [];
      if (dsldHits.length < 8) {
        try {
          usdaHits = (await searchUSDA(q)).slice(0, 8 - dsldHits.length).map((h): LookupHit => ({
            key: `usda:${h.fdcId}`, name: h.description, brand: h.brand, source: 'usda', fdcId: h.fdcId,
          }));
        } catch {
          // USDA proxy not configured (501) or down — DSLD results alone are fine.
        }
      }
      setResults([...dsldHits, ...usdaHits]);
      setStatus('idle');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }

  async function pick(hit: LookupHit) {
    setStatus('saving');
    setErrorMsg(undefined);
    try {
      if (hit.source === 'dsld' && hit.dsldId) {
        const label = await getDsldLabel(hit.dsldId);
        setPending({ supplement: normalizeDsldLabel(label), source: 'NIH DSLD' });
      } else if (hit.fdcId) {
        setPending({ supplement: supplementFromUsda(await getUsdaFood(hit.fdcId)), source: 'USDA' });
      }
      setStatus('confirm');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }

  async function confirmSave() {
    if (!pending) return;
    setStatus('saving');
    try {
      const id = await upsertMedCatalogFromSupplement(pending.supplement);
      onSelect(id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }

  const searchable = status !== 'resolving-upc' && status !== 'confirm';

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grip" />
        <div className="sheet-header">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <h2>Find supplement</h2>
          <span style={{ width: 46 }} />
        </div>
        <div className="sheet-body">
          {status === 'resolving-upc' && (
            <div className="empty">Looking up UPC {upc}…</div>
          )}

          {status === 'confirm' && pending && (
            <>
              <div className="field">
                <label>Found via {pending.source}</label>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{pending.supplement.name}</div>
                {pending.supplement.brand && (
                  <div style={{ color: 'var(--ink-soft)', fontSize: 13, marginTop: 2 }}>{pending.supplement.brand}</div>
                )}
                <div className="hint" style={{ margin: '8px 2px 0' }}>
                  {nutrientCount(pending.supplement.perDose)} nutrient{nutrientCount(pending.supplement.perDose) === 1 ? '' : 's'} per dose
                  {pending.supplement.defaultDoseAmount !== undefined
                    && ` · 1 dose = ${pending.supplement.defaultDoseAmount} ${pending.supplement.defaultDoseUnit ?? ''}`}
                </div>
              </div>
              <div className="sheet-actions">
                <button type="button" className="btn ghost" onClick={() => { setPending(undefined); setStatus('idle'); }}>
                  Not it
                </button>
                <button type="button" className="btn save" onClick={() => void confirmSave()}>
                  Use this
                </button>
              </div>
            </>
          )}

          {status === 'upc-not-found' && (
            <div className="hint" style={{ margin: '0 2px 14px' }}>
              No supplement match for UPC {upc}. Try searching by name below.
            </div>
          )}

          {searchable && (
            <>
              <div className="field">
                <label>Search supplements (NIH DSLD)</label>
                <input
                  type="text"
                  placeholder="e.g. baby vitamin d drops"
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
                      key={r.key}
                      type="button"
                      className="entry"
                      style={{ width: '100%', textAlign: 'left', background: 'none', borderBottom: '1px solid var(--line-soft)' }}
                      onClick={() => void pick(r)}
                      disabled={status === 'saving'}
                    >
                      <div className="body">
                        <div className="title">{r.name}</div>
                        <div className="meta">
                          {r.brand ? `${r.brand} · ` : ''}{r.source === 'dsld' ? 'DSLD' : 'USDA'}
                          {r.offMarket ? ' · off-market label' : ''}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {status === 'saving' && <div className="hint" style={{ margin: '14px 2px 0' }}>Loading…</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
