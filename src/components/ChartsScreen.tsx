import { useState } from 'react';
import { NutritionDay } from './NutritionDay';
import { GrowthChart } from './GrowthChart';
import { PlotBuilder } from './PlotBuilder';

// Charts tab shell. Nutrition (W4) and Growth (W5) slots are frozen from
// Phase 3; the Plot Builder slot (W6b) was added in Phase 4.
export function ChartsScreen() {
  const [view, setView] = useState<'nutrition' | 'growth' | 'plots'>('nutrition');
  return (
    <>
      <div className="choices" style={{ marginTop: 8 }}>
        <button type="button" className={`chip ${view === 'nutrition' ? 'on' : ''}`} onClick={() => setView('nutrition')}>Nutrition</button>
        <button type="button" className={`chip ${view === 'growth' ? 'on' : ''}`} onClick={() => setView('growth')}>Growth</button>
        <button type="button" className={`chip ${view === 'plots' ? 'on' : ''}`} onClick={() => setView('plots')}>Plot Builder</button>
      </div>
      {view === 'nutrition' && <NutritionDay />}
      {view === 'growth' && <GrowthChart />}
      {view === 'plots' && <PlotBuilder />}
    </>
  );
}
