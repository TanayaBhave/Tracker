// Sync server URL + token + status (device-local, via localStorage).
// Implemented by workstream W2.
import { useState } from 'react';
import { syncNow, syncConfigChanged, useSyncStatus } from '../sync';

const STATE_LABEL: Record<string, string> = {
  off: 'Off — enter a token to enable sync',
  idle: 'Up to date',
  syncing: 'Syncing…',
  offline: 'Offline — will retry when back online',
  error: 'Sync error — check the URL and token',
};

function fmtWhen(iso: string | null): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function SyncSettings() {
  const [url, setUrl] = useState(localStorage.getItem('syncUrl') ?? '');
  const [token, setToken] = useState(localStorage.getItem('syncToken') ?? '');
  const { state, lastSyncAt, pendingCount } = useSyncStatus();

  function saveUrl(v: string) {
    setUrl(v);
    localStorage.setItem('syncUrl', v.trim());
    syncConfigChanged();
  }
  function saveToken(v: string) {
    setToken(v);
    localStorage.setItem('syncToken', v.trim());
    syncConfigChanged();
  }

  return (
    <>
      <div className="section-label">Sync</div>
      <div className="field">
        <label>Server URL</label>
        <input
          type="text"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://server.tailnet.ts.net — leave blank if app is served from the server"
          value={url}
          onChange={(e) => saveUrl(e.target.value)}
        />
      </div>
      <div className="field">
        <label>Access token</label>
        <input
          type="password"
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="Shared family token"
          value={token}
          onChange={(e) => saveToken(e.target.value)}
        />
        <div className="hint" style={{ margin: '6px 2px 0' }}>
          Both phones must use the same token — it's what joins them to the shared dataset.
        </div>
      </div>
      <div className="entry"><div className="body">
        <div className="title">{STATE_LABEL[state] ?? state}</div>
        <div className="meta">
          {pendingCount} change{pendingCount === 1 ? '' : 's'} waiting to sync · last synced {fmtWhen(lastSyncAt)}
        </div>
      </div></div>
      <div className="sheet-actions">
        <button className="btn ghost" onClick={() => { void syncNow(); }}>Sync now</button>
      </div>
    </>
  );
}
