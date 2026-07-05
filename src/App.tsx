import React from 'react';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, todayStr, deviceLabel } from './db';
import { Timeline } from './components/Timeline';
import {
  MealSheet, VomitSheet, StoolSheet, MedSheet,
  GasSheet, ActivitySheet, SleepSheet, WeightSheet, SymptomSheet,
} from './components/sheets';

type SheetKey =
  | 'meal' | 'vomit' | 'stool' | 'med' | 'gas' | 'activity' | 'sleep' | 'weight' | 'symptom' | null;

type SheetProps = { onClose: () => void; editId?: string };
const SHEETS: Record<string, (p: SheetProps) => React.ReactElement> = {
  meal: MealSheet, vomit: VomitSheet, stool: StoolSheet, med: MedSheet,
  gas: GasSheet, activity: ActivitySheet, sleep: SleepSheet, weight: WeightSheet, symptom: SymptomSheet,
};

type SelectHandler = (id: string, type: string) => void;

function Home({ open, onSelect }: { open: (k: SheetKey) => void; onSelect: SelectHandler }) {
  const today = todayStr();
  return (
    <>
      <div className="quickgrid">
        <button className="qbtn primary wide" onClick={() => open('meal')}><span className="ico">🍽</span> Meal</button>
        <button className="qbtn" onClick={() => open('vomit')}><span className="ico">🤢</span> Vomit</button>
        <button className="qbtn" onClick={() => open('stool')}><span className="ico">💩</span> Nappy</button>
        <button className="qbtn" onClick={() => open('med')}><span className="ico">💊</span> Med</button>
        <button className="qbtn" onClick={() => open('sleep')}><span className="ico">😴</span> Sleep</button>
        <button className="qbtn" onClick={() => open('gas')}><span className="ico">🌀</span> Gassiness</button>
        <button className="qbtn" onClick={() => open('activity')}><span className="ico">🤸</span> Activity</button>
        <button className="qbtn" onClick={() => open('symptom')}><span className="ico">📋</span> Symptoms</button>
        <button className="qbtn" onClick={() => open('weight')}><span className="ico">⚖️</span> Weight</button>
      </div>
      <div className="section-label">Today</div>
      <Timeline dateStr={today} onSelect={onSelect} />
    </>
  );
}

function History({ onSelect }: { onSelect: SelectHandler }) {
  const [date, setDate] = useState(todayStr());
  return (
    <>
      <div className="field" style={{ marginTop: 8 }}>
        <label>Pick a day</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <Timeline dateStr={date} onSelect={onSelect} />
    </>
  );
}

function Settings() {
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

export default function App() {
  const [tab, setTab] = useState<'home' | 'history' | 'settings'>('home');
  const [sheet, setSheet] = useState<SheetKey>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const SheetComp = sheet ? SHEETS[sheet] : null;
  const dateLabel = new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  function openAdd(k: SheetKey) { setSheet(k); setEditId(null); }
  function handleSelect(id: string, type: string) { setEditId(id); setSheet(type as SheetKey); }
  function closeSheet() { setSheet(null); setEditId(null); }

  return (
    <div className="app">
      <div className="topbar">
        <h1>{tab === 'home' ? 'Today' : tab === 'history' ? 'History' : 'Settings'}</h1>
        <span className="date">{dateLabel}</span>
      </div>
      <div className="content">
        {tab === 'home' && <Home open={openAdd} onSelect={handleSelect} />}
        {tab === 'history' && <History onSelect={handleSelect} />}
        {tab === 'settings' && <Settings />}
      </div>

      <nav className="nav">
        <button className={tab === 'home' ? 'active' : ''} onClick={() => setTab('home')}><span className="ico">➕</span>Log</button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><span className="ico">📅</span>History</button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}><span className="ico">⚙️</span>Settings</button>
      </nav>

      {SheetComp && <SheetComp onClose={closeSheet} editId={editId ?? undefined} />}
    </div>
  );
}
