import React from 'react';
import { useState } from 'react';
import { todayStr } from './db';
import { Timeline } from './components/Timeline';
import { Settings } from './components/Settings';
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
