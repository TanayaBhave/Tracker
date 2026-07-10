// Manage user-defined Factors (Manage Factors — CLAUDE.md key screen #5):
// create/edit/archive custom labels like "Car ride", "Lack of sleep",
// "Teething", plus a per-factor "Log" shortcut into FactorEventSheet. A
// list/management screen, not a single-record edit form, so it builds its
// own sheet-backdrop/sheet markup (like CatalogManagerSheet) instead of
// using the single-save-button <Sheet> wrapper — each row's Edit/Archive
// action, and the new-factor form, all save independently.
//
// Factors are archived, not deleted (CLAUDE.md is explicit: past
// FactorEvents referencing a Factor must stay meaningful in History/Plot
// Builder), so `deleted` stays 0 for every Factor created here — only
// `archived` toggles.
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, baseFields } from '../db';
import type { Factor, FactorKind } from '../db';
import { ChipSelect } from './Fields';
import { FactorEventSheet } from './sheets/FactorEventSheet';

type Props = { onClose: () => void; defaultDate?: string };

const KIND_OPTIONS: { value: FactorKind; label: string }[] = [
  { value: 'instant', label: 'Instant' },
  { value: 'duration', label: 'Duration' },
  { value: 'scale', label: 'Scale' },
];

function kindLabel(kind: FactorKind): string {
  return KIND_OPTIONS.find((o) => o.value === kind)?.label ?? kind;
}

export function FactorManagerSheet({ onClose, defaultDate }: Props) {
  const factors = useLiveQuery(() => db.factors.where('deleted').equals(0).toArray(), []);

  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<FactorKind>('instant');
  const [newUnit, setNewUnit] = useState('');

  const [editingId, setEditingId] = useState<string>();
  const [editName, setEditName] = useState('');
  const [editKind, setEditKind] = useState<FactorKind>('instant');
  const [editUnit, setEditUnit] = useState('');

  const [showArchived, setShowArchived] = useState(false);
  const [loggingFactorId, setLoggingFactorId] = useState<string>();

  const all = useMemo(() => factors ?? [], [factors]);
  const active = useMemo(
    () => all.filter((f) => f.archived === 0).sort((a, b) => a.name.localeCompare(b.name)),
    [all],
  );
  const archived = useMemo(
    () => all.filter((f) => f.archived === 1).sort((a, b) => a.name.localeCompare(b.name)),
    [all],
  );

  async function addFactor() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const rec: Factor = {
      ...baseFields(),
      type: 'factor',
      name: trimmed,
      kind: newKind,
      unit: newKind !== 'instant' && newUnit.trim() ? newUnit.trim() : undefined,
      archived: 0,
    };
    await db.factors.add(rec);
    setNewName('');
    setNewKind('instant');
    setNewUnit('');
  }

  function startEdit(f: Factor) {
    setEditingId(f.id);
    setEditName(f.name);
    setEditKind(f.kind);
    setEditUnit(f.unit ?? '');
  }

  async function saveEdit(f: Factor) {
    const trimmed = editName.trim();
    if (!trimmed) return;
    await db.factors.put({
      ...f,
      name: trimmed,
      kind: editKind,
      unit: editKind !== 'instant' && editUnit.trim() ? editUnit.trim() : undefined,
      updatedAt: new Date().toISOString(),
    });
    setEditingId(undefined);
  }

  async function toggleArchive(f: Factor) {
    await db.factors.put({ ...f, archived: f.archived === 1 ? 0 : 1, updatedAt: new Date().toISOString() });
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose}>
        <div className="sheet" onClick={(e) => e.stopPropagation()}>
          <div className="grip" />
          <div className="sheet-header">
            <button type="button" className="btn ghost" onClick={onClose}>Close</button>
            <h2>Manage factors</h2>
            <span style={{ width: 46 }} />
          </div>
          <div className="sheet-body">
            <div className="field">
              <label>New factor</label>
              <input
                type="text" placeholder="e.g. Car ride"
                value={newName} onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="field">
              <ChipSelect value={newKind} allowClear={false} onChange={(v) => v && setNewKind(v)} options={KIND_OPTIONS} />
            </div>
            {newKind !== 'instant' && (
              <div className="field">
                <input
                  type="text"
                  placeholder={newKind === 'scale' ? 'Unit hint, e.g. 0-5' : 'Unit hint, e.g. min'}
                  value={newUnit} onChange={(e) => setNewUnit(e.target.value)}
                />
              </div>
            )}
            <div className="choices" style={{ marginBottom: 18 }}>
              <button type="button" className="chip on" onClick={() => { void addFactor(); }}>+ Add factor</button>
            </div>

            {active.length === 0 && <div className="empty">No factors yet. Add one above.</div>}
            {active.map((f) => (
              <div key={f.id} className="entry" style={{ padding: '11px 4px' }}>
                <div className="body">
                  {editingId === f.id ? (
                    <>
                      <input
                        type="text" value={editName} style={{ marginBottom: 8 }}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                      <div className="choices" style={{ marginBottom: 8 }}>
                        <ChipSelect value={editKind} allowClear={false} onChange={(v) => v && setEditKind(v)} options={KIND_OPTIONS} />
                      </div>
                      {editKind !== 'instant' && (
                        <input
                          type="text" placeholder="Unit hint" value={editUnit} style={{ marginBottom: 8 }}
                          onChange={(e) => setEditUnit(e.target.value)}
                        />
                      )}
                      <div className="choices">
                        <button type="button" className="chip" onClick={() => { void saveEdit(f); }}>Save</button>
                        <button type="button" className="chip" onClick={() => setEditingId(undefined)}>Cancel</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="title">{f.name}</div>
                      <div className="meta">{kindLabel(f.kind)}{f.unit ? ` · ${f.unit}` : ''}</div>
                      <div className="choices" style={{ marginTop: 8 }}>
                        <button type="button" className="chip on" onClick={() => setLoggingFactorId(f.id)}>Log</button>
                        <button type="button" className="chip" onClick={() => startEdit(f)}>Edit</button>
                        <button type="button" className="chip" onClick={() => { void toggleArchive(f); }}>Archive</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}

            {archived.length > 0 && (
              <div className="more-detail">
                <button
                  type="button" className="more-detail-toggle"
                  onClick={() => setShowArchived((s) => !s)} aria-expanded={showArchived}
                >
                  <span>Archived ({archived.length})</span>
                  <span className={`chev ${showArchived ? 'open' : ''}`}>⌄</span>
                </button>
                {showArchived && archived.map((f) => (
                  <div key={f.id} className="entry" style={{ padding: '11px 4px' }}>
                    <div className="body">
                      <div className="title">{f.name}</div>
                      <div className="meta">{kindLabel(f.kind)}{f.unit ? ` · ${f.unit}` : ''}</div>
                      <div className="choices" style={{ marginTop: 8 }}>
                        <button type="button" className="chip" onClick={() => { void toggleArchive(f); }}>Unarchive</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {loggingFactorId && (
        <FactorEventSheet
          factorId={loggingFactorId}
          defaultDate={defaultDate}
          onClose={() => setLoggingFactorId(undefined)}
        />
      )}
    </>
  );
}
