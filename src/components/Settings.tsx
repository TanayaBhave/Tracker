import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, deviceLabel } from '../db';
import { BabyProfileSettings } from './BabyProfileSettings';
import { SyncSettings } from './SyncSettings';

export function Settings() {
  const [label, setLabel] = useState(deviceLabel());
  const counts = useLiveQuery(async () => ({
    meals: await db.meals.where('deleted').equals(0).count(),
    vomits: await db.vomits.where('deleted').equals(0).count(),
    stools: await db.stools.where('deleted').equals(0).count(),
  }));
  function saveLabel(v: string) { setLabel(v); localStorage.setItem('deviceLabel', v); }
  return (
    <>
      <div className="field" style={{ marginTop: 8 }}>
        <label>This device's name</label>
        <input type="text" placeholder="e.g. Mum's iPhone" value={label === 'unset' ? '' : label} onChange={(e) => saveLabel(e.target.value)} />
        <div className="hint" style={{ margin: '6px 2px 0' }}>Tags who entered each record. Helpful once both phones are syncing.</div>
      </div>
      <BabyProfileSettings />
      <SyncSettings />
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
