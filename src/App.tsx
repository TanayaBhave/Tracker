import React from 'react';
import { useState } from 'react';
import { addDaysLocal, todayStr } from './db';
import { Timeline } from './components/Timeline';
import { Settings } from './components/Settings';
import { ChartsScreen } from './components/ChartsScreen';
import { FactorManagerSheet } from './components/FactorManagerSheet';
import {
  MealSheet, VomitSheet, StoolSheet, MedSheet,
  GasSheet, ActivitySheet, SleepSheet, WeightSheet, SymptomSheet,
} from './components/sheets';
import { FactorEventSheet } from './components/sheets/FactorEventSheet';
import {
  Utensils, Activity as VomitIcon, Baby, Pill, Moon, Wind, Footprints, Stethoscope, Scale,
  CalendarDays, Lightbulb, History as HistoryIcon, Settings as SettingsIcon, Sparkles,
} from 'lucide-react';

type SheetKey =
  | 'meal' | 'vomit' | 'stool' | 'med' | 'gas' | 'activity' | 'sleep' | 'weight' | 'symptom'
  | 'factorEvent' | null;

type SheetProps = { onClose: () => void; editId?: string; defaultDate?: string };
const SHEETS: Record<string, (p: SheetProps) => React.ReactElement> = {
  meal: MealSheet, vomit: VomitSheet, stool: StoolSheet, med: MedSheet,
  gas: GasSheet, activity: ActivitySheet, sleep: SleepSheet, weight: WeightSheet, symptom: SymptomSheet,
  factorEvent: FactorEventSheet,
};

type SelectHandler = (id: string, type: string) => void;

// Shared by Home's always-visible grid and History's "+" quick-add popup —
// identical tiles either way, just a different place to tap them from.
function QuickAddGrid({
  open, onOpenFactorManager,
}: {
  open: (k: SheetKey) => void; onOpenFactorManager: () => void;
}) {
  return (
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
      <button className="qbtn tone-factor" onClick={onOpenFactorManager}><Sparkles size={22} aria-hidden="true" /><span>Factor</span></button>
    </div>
  );
}

function Home({
  open, onSelect, onOpenFactorManager,
}: {
  open: (k: SheetKey) => void; onSelect: SelectHandler; onOpenFactorManager: () => void;
}) {
  const today = todayStr();
  return (
    <>
      <div className="section-label">Quick add</div>
      <QuickAddGrid open={open} onOpenFactorManager={onOpenFactorManager} />
      <Timeline dateStr={today} onSelect={onSelect} />
    </>
  );
}

function History({
  onSelect, open, onOpenFactorManager,
}: {
  onSelect: SelectHandler;
  open: (k: SheetKey, date: string) => void;
  onOpenFactorManager: (date: string) => void;
}) {
  const [date, setDate] = useState(todayStr());
  const [quickAddOpen, setQuickAddOpen] = useState(false);
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

      <div className="fab-anchor">
        <button type="button" className="fab" aria-label={`Add to ${weekdayLabel}`} onClick={() => setQuickAddOpen(true)}>+</button>
      </div>

      {quickAddOpen && (
        <div className="sheet-backdrop" onClick={() => setQuickAddOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="grip" />
            <div className="sheet-header">
              <button type="button" className="btn ghost" onClick={() => setQuickAddOpen(false)}>Cancel</button>
              <h2>Add to {weekdayLabel}</h2>
              <span style={{ width: 46 }} />
            </div>
            <div className="sheet-body">
              <QuickAddGrid
                open={(k) => { setQuickAddOpen(false); open(k, date); }}
                onOpenFactorManager={() => { setQuickAddOpen(false); onOpenFactorManager(date); }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function App() {
  const [tab, setTab] = useState<'home' | 'history' | 'charts' | 'settings'>('home');
  const [sheet, setSheet] = useState<SheetKey>(null);
  const [editId, setEditId] = useState<string | null>(null);
  // FactorManagerSheet isn't dispatched through SHEETS/SheetKey like the
  // fixed event-type sheets — Home's "Factor" tile can't know in advance
  // which Factor to log (there may be several, or none yet), so it opens
  // this management screen instead, which owns its own per-factor "Log"
  // entry point into FactorEventSheet. Kept as separate state so it can be
  // open independently of the SheetKey-driven quick-add/edit sheets.
  const [factorManagerOpen, setFactorManagerOpen] = useState(false);
  // Set only when a NEW entry is opened from History's "+" (quick-add for a
  // day other than today) — carries that day into the opened sheet's initial
  // date/time so backfilling doesn't require re-picking it. Left undefined
  // for Home's quick-add (defaults to "now", as before) and for editing an
  // existing entry (its own saved date always wins once loaded).
  const [addDate, setAddDate] = useState<string>();
  const SheetComp = sheet ? SHEETS[sheet] : null;
  const dateLabel = new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  function openAdd(k: SheetKey, date?: string) { setSheet(k); setEditId(null); setAddDate(date); }
  function handleSelect(id: string, type: string) { setEditId(id); setSheet(type as SheetKey); setAddDate(undefined); }
  function closeSheet() { setSheet(null); setEditId(null); setAddDate(undefined); }
  function openFactorManager(date?: string) { setAddDate(date); setFactorManagerOpen(true); }
  function closeFactorManager() { setFactorManagerOpen(false); setAddDate(undefined); }

  return (
    <div className="app">
      <div className="topbar">
        <h1>{tab === 'home' ? 'Today' : tab === 'history' ? 'History' : tab === 'charts' ? 'Insights' : 'Settings'}</h1>
        <span className="date">{dateLabel}</span>
      </div>
      <div className="content">
        {tab === 'home' && (
          <Home open={openAdd} onSelect={handleSelect} onOpenFactorManager={() => openFactorManager()} />
        )}
        {tab === 'history' && (
          <History onSelect={handleSelect} open={openAdd} onOpenFactorManager={openFactorManager} />
        )}
        {tab === 'charts' && <ChartsScreen />}
        {tab === 'settings' && <Settings />}
      </div>

      <nav className="nav">
        <button className={tab === 'home' ? 'active' : ''} onClick={() => setTab('home')}><CalendarDays size={20} aria-hidden="true" />Today</button>
        <button className={tab === 'charts' ? 'active' : ''} onClick={() => setTab('charts')}><Lightbulb size={20} aria-hidden="true" />Insights</button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><HistoryIcon size={20} aria-hidden="true" />History</button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}><SettingsIcon size={20} aria-hidden="true" />Settings</button>
      </nav>

      {SheetComp && <SheetComp onClose={closeSheet} editId={editId ?? undefined} defaultDate={addDate} />}
      {factorManagerOpen && <FactorManagerSheet onClose={closeFactorManager} defaultDate={addDate} />}
    </div>
  );
}
