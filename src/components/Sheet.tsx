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
        <div className="sheet-header">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <h2>{title}</h2>
          <button type="button" className="btn save" onClick={onSave}>{saveLabel}</button>
        </div>
        <div className="sheet-body">
          {warn && <div className="warn-banner">{warn}</div>}
          {children}
          {onDelete && (
            <button type="button" className="btn ghost sheet-delete" onClick={onDelete}>
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
