import React from 'react';
import { useState } from 'react';
import { todayStr } from './db';
import { Timeline } from './components/Timeline';
import { Settings } from './components/Settings';
import { ChartsScreen } from './components/ChartsScreen';
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
      <div className="section-label">Quick add</div>
      <div className="quickgrid">
        <button className="qbtn tone-meal" onClick={() => open('meal')}><span className="ico">🍽</span><span>Meal</span></button>
        <button className="qbtn tone-vomit" onClick={() => open('vomit')}><span className="ico">🤢</span><span>Vomit</span></button>
        <button className="qbtn tone-stool" onClick={() => open('stool')}><span className="ico">💩</span><span>Nappy</span></button>
        <button className="qbtn tone-med" onClick={() => open('med')}><span className="ico">💊</span><span>Med</span></button>
        <button className="qbtn tone-sleep" onClick={() => open('sleep')}><span className="ico">😴</span><span>Sleep</span></button>
        <button className="qbtn tone-gas" onClick={() => open('gas')}><span className="ico">🌀</span><span>Gassiness</span></button>
        <button className="qbtn tone-activity" onClick={() => open('activity')}><span className="ico">🤸</span><span>Activity</span></button>
        <button className="qbtn tone-symptom" onClick={() => open('symptom')}><span className="ico">📋</span><span>Symptoms</span></button>
        <button className="qbtn tone-weight" onClick={() => open('weight')}><span className="ico">⚖️</span><span>Weight</span></button>
      </div>
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
  const [tab, setTab] = useState<'home' | 'history' | 'charts' | 'settings'>('home');
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
        <h1>{tab === 'home' ? 'Today' : tab === 'history' ? 'History' : tab === 'charts' ? 'Insights' : 'Settings'}</h1>
        <span className="date">{dateLabel}</span>
      </div>
      <div className="content">
        {tab === 'home' && <Home open={openAdd} onSelect={handleSelect} />}
        {tab === 'history' && <History onSelect={handleSelect} />}
        {tab === 'charts' && <ChartsScreen />}
        {tab === 'settings' && <Settings />}
      </div>

      <nav className="nav">
        <button className={tab === 'home' ? 'active' : ''} onClick={() => setTab('home')}><span className="ico">📆</span>Today</button>
        <button className={tab === 'charts' ? 'active' : ''} onClick={() => setTab('charts')}><span className="ico">📊</span>Insights</button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><span className="ico">🕐</span>History</button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}><span className="ico">⚙️</span>Settings</button>
      </nav>

      {SheetComp && <SheetComp onClose={closeSheet} editId={editId ?? undefined} />}
    </div>
  );
}
