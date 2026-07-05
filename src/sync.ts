// Client sync engine (workstream W2). Local-first: Dexie is the on-device source of
// truth; this module pushes dirty rows to the server and pulls newer ones back.
//
// Cursor = server change counter (serverSeq), clock-skew immune. `updatedAt` is used
// ONLY for last-write-wins conflict resolution, on both server and client.
//
// Device-local state (localStorage, never synced):
//   syncUrl      — base URL of the sync server ('' = same-origin)
//   syncToken    — shared bearer token
//   syncCursor   — last seen serverSeq (number as string)
//   lastPushedAt — max updatedAt among rows successfully pushed
//   lastSyncAt   — ISO time of last successful sync
//   clientId     — stable uuid for this device, generated once
import { useSyncExternalStore } from 'react';
import { db, SYNC_TABLES, newId } from './db';

export type SyncState = 'off' | 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  state: SyncState;
  lastSyncAt: string | null;
  pendingCount: number;
}

interface SyncRow {
  id: string;
  updatedAt: string;
  [key: string]: unknown;
}

interface ChangeGroup {
  tbl: string;
  rows: SyncRow[];
}

interface SyncResponse {
  serverSeq: number;
  changes: ChangeGroup[];
}

const PULL_PAGE_SIZE = 1000;
const DEBOUNCE_MS = 3000;
const INTERVAL_MS = 60_000;

// ---- Status store (useSyncExternalStore) ----

let status: SyncStatus = {
  state: localStorage.getItem('syncToken') ? 'idle' : 'off',
  lastSyncAt: localStorage.getItem('lastSyncAt'),
  pendingCount: 0,
};
const listeners = new Set<() => void>();

function emit(patch: Partial<SyncStatus>) {
  const next = { ...status, ...patch };
  if (
    next.state === status.state &&
    next.lastSyncAt === status.lastSyncAt &&
    next.pendingCount === status.pendingCount
  ) return;
  status = next;
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function getSnapshot(): SyncStatus {
  return status;
}

/** Live sync status for UI: state, last successful sync time, and dirty-row count. */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Call after syncUrl/syncToken change in Settings so the status pill updates immediately. */
export function syncConfigChanged() {
  const hasToken = !!localStorage.getItem('syncToken');
  if (!hasToken) emit({ state: 'off' });
  else if (status.state === 'off') emit({ state: 'idle' });
}

// ---- Helpers ----

function clientId(): string {
  let id = localStorage.getItem('clientId');
  if (!id) {
    id = newId();
    localStorage.setItem('clientId', id);
  }
  return id;
}

function baseUrl(): string {
  return (localStorage.getItem('syncUrl') ?? '').trim().replace(/\/+$/, '');
}

/** Rows changed since the last successful push, per table. All writes bump updatedAt. */
async function collectDirty(): Promise<ChangeGroup[]> {
  const since = localStorage.getItem('lastPushedAt') || '';
  const groups: ChangeGroup[] = [];
  for (const tbl of SYNC_TABLES) {
    const rows = (await db.table(tbl).where('updatedAt').above(since).toArray()) as SyncRow[];
    if (rows.length > 0) groups.push({ tbl, rows });
  }
  return groups;
}

async function countDirty(): Promise<number> {
  const since = localStorage.getItem('lastPushedAt') || '';
  let n = 0;
  for (const tbl of SYNC_TABLES) {
    n += await db.table(tbl).where('updatedAt').above(since).count();
  }
  return n;
}

async function refreshPending() {
  try {
    emit({ pendingCount: await countDirty() });
  } catch {
    // Dexie unavailable (e.g. db closing) — keep the old count.
  }
}

// True while we're writing pulled rows into Dexie, so table hooks don't re-schedule.
let applyingPull = false;

/** Writes pulled rows into Dexie in ONE rw transaction, guarded by client-side LWW. */
async function applyPulled(changes: ChangeGroup[]) {
  const known = changes.filter((g) => (SYNC_TABLES as readonly string[]).includes(g.tbl));
  if (known.length === 0) return;
  applyingPull = true;
  try {
    await db.transaction('rw', [...SYNC_TABLES], async () => {
      for (const { tbl, rows } of known) {
        const table = db.table(tbl);
        for (const row of rows) {
          if (!row || typeof row.id !== 'string' || typeof row.updatedAt !== 'string') continue;
          const existing = (await table.get(row.id)) as SyncRow | undefined;
          // Client-side LWW guard: makes any server echo of our own push a no-op.
          if (!existing || row.updatedAt > existing.updatedAt) await table.put(row);
        }
      }
    });
  } finally {
    applyingPull = false;
  }
}

// ---- Core sync ----

let running = false;

/**
 * Push dirty rows, pull newer ones, advance the cursor. Single-flight; never throws.
 * Loops while the server returns full pages.
 */
export async function syncNow(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const token = localStorage.getItem('syncToken');
    if (!token) {
      emit({ state: 'off' });
      return;
    }
    emit({ state: 'syncing' });

    const dirty = await collectDirty();
    let pushMax = '';
    for (const g of dirty) for (const r of g.rows) if (r.updatedAt > pushMax) pushMax = r.updatedAt;

    let first = true;
    for (let page = 0; page < 50; page++) { // safety cap; ~50k rows per sync run
      const body = {
        clientId: clientId(),
        since: Number(localStorage.getItem('syncCursor') || 0),
        changes: first ? dirty : [],
      };
      const resp = await fetch(`${baseUrl()}/api/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error(`sync failed: HTTP ${resp.status}`);
      const data = (await resp.json()) as SyncResponse;

      await applyPulled(data.changes ?? []);

      localStorage.setItem('syncCursor', String(data.serverSeq));
      if (first && pushMax) localStorage.setItem('lastPushedAt', pushMax);
      first = false;

      const pulled = (data.changes ?? []).reduce((n, g) => n + (g.rows?.length ?? 0), 0);
      if (pulled < PULL_PAGE_SIZE) break;
    }

    localStorage.setItem('lastSyncAt', new Date().toISOString());
    emit({ state: 'idle', lastSyncAt: localStorage.getItem('lastSyncAt') });
  } catch {
    emit({ state: navigator.onLine ? 'error' : 'offline' });
  } finally {
    running = false;
    await refreshPending();
  }
}

// ---- Triggers ----

let debounceTimer: number | undefined;

/** Debounced sync — called from Dexie write hooks so saves sync ~3s after the last write. */
export function scheduleSync() {
  if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    debounceTimer = undefined;
    void syncNow();
  }, DEBOUNCE_MS);
}

let initialized = false;

/**
 * Wire up sync triggers: app start, coming online, tab becoming visible, a 60s
 * interval, and a debounced run after any local Dexie write (via table hooks —
 * no changes needed in the sheet components).
 */
export function initSync() {
  if (initialized) return;
  initialized = true;

  clientId(); // generate once

  for (const tbl of SYNC_TABLES) {
    const table = db.table(tbl);
    const onWrite = () => { if (!applyingPull) scheduleSync(); };
    table.hook('creating', onWrite);
    table.hook('updating', onWrite);
    table.hook('deleting', onWrite);
  }

  window.addEventListener('online', () => { void syncNow(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });
  window.setInterval(() => { void syncNow(); }, INTERVAL_MS);

  void syncNow();
}
