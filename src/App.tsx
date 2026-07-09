import React from 'react';
import { useState } from 'react';
import { addDaysLocal, todayStr } from './db';
import { Timeline } from './components/Timeline';
import { Settings } from './components/Settings';
import { ChartsScreen } from './components/ChartsScreen';
import {
  MealSheet, VomitSheet, StoolSheet, MedSheet,
  GasSheet, ActivitySheet, SleepSheet, WeightSheet, SymptomSheet,
} from './components/sheets';
import {
  Utensils, Activity as VomitIcon, Baby, Pill, Moon, Wind, Footprints, Stethoscope, Scale,
  CalendarDays, Lightbulb, History as HistoryIcon, Settings as SettingsIcon,
} from 'lucide-react';

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
        <button className="qbtn tone-meal" onClick={() => open('meal')}><Utensils size={22} aria-hidden="true" /><span>Meal</span></button>
        <button className="qbtn tone-vomit" onClick={() => open('vomit')}><VomitIcon size={22} aria-hidden="true" /><span>Vomit</span></button>
        <button className="qbtn tone-stool" onClick={() => open('stool')}><Baby size={22} aria-hidden="true" /><span>Nappy</span></button>
        <button className="qbtn tone-med" onClick={() => open('med')}><Pill size={22} aria-hidden="true" /><span>Med</span></button>
        <button className="qbtn tone-sleep" onClick={() => open('sleep')}><Moon size={22} aria-hidden="true" /><span>Sleep</span></button>
        <button className="qbtn tone-gas" onClick={() => open('gas')}><Wind size={22} aria-hidden="true" /><span>Gassiness</span></button>
        <button className="qbtn tone-activity" onClick={() => open('activity')}><Footprints size={22} aria-hidden="true" /><span>Activity</span></button>
        <button className="qbtn tone-symptom" onClick={() => open('symptom')}><Stethoscope size={22} aria-hidden="true" /><span>Symptoms</span></button>
        <button className="qbtn tone-weight" onClick={() => open('weight')}><Scale size={22} aria-hidden="true" /><span>Weight</span></button>
      </div>
      <Timeline dateStr={today} onSelect={onSelect} />
    </>
  );
}

function History({ onSelect }: { onSelect: SelectHandler }) {
  const [date, setDate] = useState(todayStr());
  const isTodayOrLater = date >= todayStr();
  const weekdayLabel = new Date(`${date}T00:00:00`).toLocaleDateString([], {
    weekday: 'short', month: 'short', day: 'numeric',
  });
  return (
    <>
      <div className="field" style={{ marginTop: 8 }}>
        <label>Pick a day</label>
        <div className="day-nav">
          <button
            type="button"
            className="btn ghost day-nav-btn"
            aria-label="Previous day"
            onClick={() => setDate((d) => addDaysLocal(d, -1))}
          >
            ‹
          </button>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <button
            type="button"
            className="btn ghost day-nav-btn"
            aria-label="Next day"
            disabled={isTodayOrLater}
            onClick={() => setDate((d) => addDaysLocal(d, 1))}
          >
            ›
          </button>
        </div>
        <div className="hint" style={{ margin: '6px 2px 0' }}>{weekdayLabel}</div>
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
        <button className={tab === 'home' ? 'active' : ''} onClick={() => setTab('home')}><CalendarDays size={20} aria-hidden="true" />Today</button>
        <button className={tab === 'charts' ? 'active' : ''} onClick={() => setTab('charts')}><Lightbulb size={20} aria-hidden="true" />Insights</button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><HistoryIcon size={20} aria-hidden="true" />History</button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}><SettingsIcon size={20} aria-hidden="true" />Settings</button>
      </nav>

      {SheetComp && <SheetComp onClose={closeSheet} editId={editId ?? undefined} />}
    </div>
  );
}
