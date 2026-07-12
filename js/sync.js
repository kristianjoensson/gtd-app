// sync.js - cross-device sync via a Supabase table (plain REST, no SDK).
// Local-first: the app is fully functional without config; when configured,
// dirty tasks push and remote changes pull on a poll loop.
//
// Server shape (see SETUP.md for the SQL):
//   ro_tasks(id uuid pk, workspace text, payload jsonb, updated_at timestamptz)
// Row-level security compares the x-workspace-token request header to the
// workspace column, so the anon key alone reveals nothing.

import { state, dirtyTasks, clearDirty, applyRemote, persistSettings } from './store.js';

const LS_CURSOR = 'ro.sync.cursor.v1';
const POLL_MS = 20000;

let statusCb = () => {};
let timer = null;
let pushTimer = null;
let inFlight = false;
export const sync = { status: 'off', error: null, lastOk: null };

function cfg() {
  const s = state.settings.sync;
  return s && s.url && s.anonKey && s.token ? s : null;
}

function setStatus(status, error = null) {
  sync.status = status;
  sync.error = error;
  if (status === 'ok') sync.lastOk = Date.now();
  statusCb(sync);
}

function headers(c, extra = {}) {
  return {
    apikey: c.anonKey,
    Authorization: `Bearer ${c.anonKey}`,
    'x-workspace-token': c.token,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function base(c) {
  return c.url.replace(/\/+$/, '') + '/rest/v1/ro_tasks';
}

// ---------------------------------------------------------------------------
export function initSync(onStatus) {
  statusCb = onStatus ?? statusCb;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick();
  });
  window.addEventListener('online', () => tick());
  restart();
}

export function restart() {
  clearInterval(timer);
  if (!cfg()) {
    setStatus('off');
    return;
  }
  setStatus('idle');
  timer = setInterval(tick, POLL_MS);
  tick();
}

/** Debounced push after local edits. */
export function pushSoon() {
  if (!cfg()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(tick, 900);
}

export async function tick() {
  const c = cfg();
  if (!c || inFlight || !navigator.onLine) return;
  inFlight = true;
  setStatus('syncing');
  try {
    await push(c);
    await pull(c);
    setStatus('ok');
  } catch (err) {
    setStatus('error', String(err?.message ?? err));
  } finally {
    inFlight = false;
  }
}

async function push(c) {
  const tasks = dirtyTasks();
  if (!tasks.length) return;
  const snapshot = tasks.map((t) => ({ id: t.id, updatedAt: t.updatedAt }));
  const rows = tasks.map((t) => ({
    id: t.id,
    workspace: c.token,
    payload: t,
    updated_at: new Date().toISOString(),
  }));
  const res = await fetch(`${base(c)}?on_conflict=id`, {
    method: 'POST',
    headers: headers(c, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`push ${res.status}: ${(await res.text()).slice(0, 140)}`);
  clearDirty(snapshot);
}

async function pull(c) {
  const cursor = localStorage.getItem(LS_CURSOR) ?? '1970-01-01T00:00:00Z';
  const url =
    `${base(c)}?select=payload,updated_at` +
    `&workspace=eq.${encodeURIComponent(c.token)}` +
    `&updated_at=gt.${encodeURIComponent(cursor)}` +
    `&order=updated_at.asc&limit=1000`;
  const res = await fetch(url, { headers: headers(c) });
  if (!res.ok) throw new Error(`pull ${res.status}: ${(await res.text()).slice(0, 140)}`);
  const rows = await res.json();
  if (!rows.length) return;
  applyRemote(rows.map((r) => r.payload));
  localStorage.setItem(LS_CURSOR, rows[rows.length - 1].updated_at);
}

// ---------------------------------------------------------------------------
// configuration helpers
// ---------------------------------------------------------------------------
export function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** One pasteable string carrying url + key + token between devices. */
export function encodeSyncCode(s) {
  return 'ro1.' + btoa(JSON.stringify({ u: s.url, k: s.anonKey, t: s.token }));
}

export function decodeSyncCode(code) {
  const raw = code.trim();
  if (!raw.startsWith('ro1.')) return null;
  try {
    const { u, k, t } = JSON.parse(atob(raw.slice(4)));
    if (!u || !k || !t) return null;
    return { url: u, anonKey: k, token: t };
  } catch {
    return null;
  }
}

export function saveSyncConfig(config) {
  state.settings.sync = config;
  persistSettings();
  localStorage.removeItem(LS_CURSOR); // full re-pull with the new workspace
  restart();
}

export async function testConnection(config) {
  const c = config ?? cfg();
  if (!c) return { ok: false, message: 'Udfyld alle felter først.' };
  try {
    const res = await fetch(`${base(c)}?select=id&limit=1&workspace=eq.${encodeURIComponent(c.token)}`, {
      headers: headers(c),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 140);
      return { ok: false, message: `Serveren svarede ${res.status}. ${body}` };
    }
    return { ok: true, message: 'Forbindelsen virker.' };
  } catch (err) {
    return { ok: false, message: `Kunne ikke nå serveren: ${err?.message ?? err}` };
  }
}
