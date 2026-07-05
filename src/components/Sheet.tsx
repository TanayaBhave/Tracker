import type { ReactNode } from 'react';

export function Sheet({
  title, onClose, onSave, children, saveLabel = 'Save', warn, onDelete,
}: {
  title: string;
  onClose: () => void;
  onSave: () => void;
  children: ReactNode;
  saveLabel?: string;
  warn?: string;
  onDelete?: () => void;
}) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grip" />
        <h2>{title}</h2>
        {warn && <div className="warn-banner">{warn}</div>}
        {children}
        <div className="sheet-actions">
          {onDelete && (
            <button
              className="btn ghost"
              style={{ flex: '0 0 auto', color: 'var(--alert)' }}
              onClick={onDelete}
            >
              Delete
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn save" onClick={onSave}>{saveLabel}</button>
        </div>
      </div>
    </div>
  );
}
