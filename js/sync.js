// sync.js - cross-device sync via Supabase with real login.
// Auth: Supabase Auth (vendored supabase-js handles Google OAuth redirects,
// magic-link emails, session storage and token refresh). Data: plain REST
// against the gtd_tasks table; RLS scopes every row to auth.uid().
// Local-first: with no config or no login, the app just runs locally.

import { state, dirtyTasks, clearDirty, applyRemote } from './store.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const LS_CURSOR = 'gtd.sync.cursor.v1';
const LS_USER = 'gtd.sync.user.v1';
const POLL_MS = 20000;

export const sync = { status: 'off', error: null, lastOk: null, user: null };

let client = null;
let statusCb = () => {};
let timer = null;
let pushTimer = null;
let inFlight = false;
let firstSyncCb = null;
let firstSyncPending = false;

/** Fires once after the first successful push+pull of a login session. */
export function onFirstSync(fn) {
  firstSyncCb = fn;
}

export function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase);
}

function setStatus(status, error = null) {
  sync.status = status;
  sync.error = error;
  if (status === 'ok') sync.lastOk = Date.now();
  statusCb(sync);
}

function base() {
  return SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/gtd_tasks';
}

function appUrl() {
  return location.origin + location.pathname;
}

// ---------------------------------------------------------------------------
export function initSync(onStatus) {
  statusCb = onStatus ?? statusCb;
  if (!isConfigured()) {
    setStatus('off');
    return;
  }
  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  client.auth.onAuthStateChange((_event, session) => adoptSession(session));
  client.auth.getSession().then(({ data }) => adoptSession(data.session));

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick();
  });
  window.addEventListener('online', () => tick());
}

function adoptSession(session) {
  sync.user = session?.user?.email ?? null;
  if (session?.user) {
    if (!timer) firstSyncPending = true; // fresh adoption, not a token refresh
    // First login on this device (or account switch): re-pull everything and
    // queue all local tasks so device state merges up into the account.
    const prev = localStorage.getItem(LS_USER);
    if (prev !== session.user.id) {
      localStorage.setItem(LS_USER, session.user.id);
      localStorage.removeItem(LS_CURSOR);
      for (const t of state.tasks) state.dirty.add(t.id);
    }
    clearInterval(timer);
    timer = setInterval(tick, POLL_MS);
    setStatus('idle');
    tick();
  } else {
    clearInterval(timer);
    timer = null;
    setStatus(isConfigured() ? 'signedout' : 'off');
  }
}

// ---------------------------------------------------------------------------
// auth actions (used by the settings dialog)
// ---------------------------------------------------------------------------
export async function signInWithGoogle() {
  if (!client) return { error: 'Synk er ikke sat op.' };
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: appUrl() },
  });
  return { error: error?.message ?? null }; // on success the page redirects
}

export async function signInWithEmail(email) {
  if (!client) return { error: 'Synk er ikke sat op.' };
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: appUrl() },
  });
  return { error: error?.message ?? null };
}

export async function signOutUser() {
  if (!client) return;
  await client.auth.signOut(); // local tasks stay on the device
}

// ---------------------------------------------------------------------------
// sync loop
// ---------------------------------------------------------------------------
async function authHeaders() {
  const { data } = await client.auth.getSession(); // SDK refreshes if stale
  const token = data.session?.access_token;
  if (!token) return null;
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/** Debounced push after local edits. */
export function pushSoon() {
  if (!timer) return; // not signed in
  clearTimeout(pushTimer);
  pushTimer = setTimeout(tick, 900);
}

export async function tick() {
  if (!client || !timer || inFlight || !navigator.onLine) return;
  const headers = await authHeaders();
  if (!headers) return;
  inFlight = true;
  setStatus('syncing');
  try {
    await push(headers);
    await pull(headers);
    setStatus('ok');
    if (firstSyncPending) {
      firstSyncPending = false;
      firstSyncCb?.();
    }
  } catch (err) {
    setStatus('error', String(err?.message ?? err));
  } finally {
    inFlight = false;
  }
}

async function push(headers) {
  const tasks = dirtyTasks();
  if (!tasks.length) return;
  const snapshot = tasks.map((t) => ({ id: t.id, updatedAt: t.updatedAt }));
  // user_id is filled server-side (default auth.uid()), enforced by RLS.
  const rows = tasks.map((t) => ({
    id: t.id,
    payload: t,
    updated_at: new Date().toISOString(),
  }));
  const res = await fetch(`${base()}?on_conflict=id`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`push ${res.status}: ${(await res.text()).slice(0, 140)}`);
  clearDirty(snapshot);
}

async function pull(headers) {
  const cursor = localStorage.getItem(LS_CURSOR) ?? '1970-01-01T00:00:00Z';
  const url =
    `${base()}?select=payload,updated_at` +
    `&updated_at=gt.${encodeURIComponent(cursor)}` +
    `&order=updated_at.asc&limit=1000`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`pull ${res.status}: ${(await res.text()).slice(0, 140)}`);
  const rows = await res.json();
  if (!rows.length) return;
  applyRemote(rows.map((r) => r.payload));
  localStorage.setItem(LS_CURSOR, rows[rows.length - 1].updated_at);
}
