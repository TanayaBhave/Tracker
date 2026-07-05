import { useState } from 'react';
import { NutritionDay } from './NutritionDay';
import { GrowthChart } from './GrowthChart';

// Charts tab shell. The two slots are owned by Phase-3 workstreams:
// NutritionDay.tsx (W4) and GrowthChart.tsx (W5) — this file stays frozen.
export function ChartsScreen() {
  const [view, setView] = useState<'nutrition' | 'growth'>('nutrition');
  return (
    <>
      <div className="choices" style={{ marginTop: 8 }}>
        <button type="button" className={`chip ${view === 'nutrition' ? 'on' : ''}`} onClick={() => setView('nutrition')}>Nutrition</button>
        <button type="button" className={`chip ${view === 'growth' ? 'on' : ''}`} onClick={() => setView('growth')}>Growth</button>
      </div>
      {view === 'nutrition' ? <NutritionDay /> : <GrowthChart />}
    </>
  );
}
