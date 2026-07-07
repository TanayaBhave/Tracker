import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, deviceLabel } from '../db';
import { BabyProfileSettings } from './BabyProfileSettings';
import { SyncSettings } from './SyncSettings';
import { refreshNutritionData } from '../nutrition/refresh';

export function Settings() {
  const [label, setLabel] = useState(deviceLabel());
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string>();
  const counts = useLiveQuery(async () => ({
    meals: await db.meals.where('deleted').equals(0).count(),
    vomits: await db.vomits.where('deleted').equals(0).count(),
    stools: await db.stools.where('deleted').equals(0).count(),
  }));
  function saveLabel(v: string) { setLabel(v); localStorage.setItem('deviceLabel', v); }

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshMsg(undefined);
    try {
      const result = await refreshNutritionData();
      const parts = [`Updated ${result.updated} food${result.updated === 1 ? '' : 's'}`];
      if (result.reblended > 0) parts.push(`re-blended ${result.reblended} recipe${result.reblended === 1 ? '' : 's'}`);
      if (result.failed > 0) parts.push(`${result.failed} failed`);
      setRefreshMsg(parts.join(', '));
    } catch (err) {
      setRefreshMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      <div className="field" style={{ marginTop: 8 }}>
        <label>This device's name</label>
        <input type="text" placeholder="e.g. Mum's iPhone" value={label === 'unset' ? '' : label} onChange={(e) => saveLabel(e.target.value)} />
        <div className="hint" style={{ margin: '6px 2px 0' }}>Tags who entered each record. Helpful once both phones are syncing.</div>
      </div>
      <BabyProfileSettings />
      <SyncSettings />
      <div className="section-label">Nutrition data</div>
      <div className="sheet-actions">
        <button type="button" className="btn ghost" onClick={() => { void handleRefresh(); }} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh nutrition data'}
        </button>
      </div>
      <div className="hint" style={{ margin: '6px 2px 0' }}>
        Re-fetches USDA-sourced foods (picks up newly-added nutrients like sugar) and re-blends recipes built from them. Needs a network connection.
      </div>
      {refreshMsg && <div className="hint" style={{ margin: '6px 2px 0' }}>{refreshMsg}</div>}
      <div className="section-label">Stored locally</div>
      <div className="entry"><div className="body">
        <div className="title">{counts?.meals ?? 0} meals · {counts?.vomits ?? 0} vomits · {counts?.stools ?? 0} nappies</div>
        <div className="meta">Saved offline on this device. Sync to the home server comes in a later milestone — until then, this data lives only here.</div>
      </div></div>
      <div className="warn-banner" style={{ marginTop: 16 }}>
        Pattern-spotting tool, not medical advice. It helps you bring clear data to your appointment — it doesn't diagnose.
      </div>
    </>
  );
}
