// store.js - task state, persistence (localStorage) and change notifications.
// Mirrors Tempo's model: inbox + board columns, status open/done,
// completedAt/loggedAt, soft delete via `deleted` (sync tombstone).

const LS_TASKS = 'gtd.tasks.v1';
const LS_SETTINGS = 'gtd.settings.v1';
const LS_DIRTY = 'gtd.sync.dirty.v1';

export const COLUMNS = [
  { id: 'inbox', label: 'Indbakke' },
  { id: 'next', label: 'Næste' },
  { id: 'doing', label: 'I gang' },
  { id: 'later', label: 'Senere' },
];

export const COLUMN_LABEL = Object.fromEntries(COLUMNS.map((c) => [c.id, c.label]));

const listeners = new Set();
let saveTimer = null;

export const state = {
  tasks: [],
  settings: { sync: null }, // sync: {url, anonKey, token}
  dirty: new Set(), // task ids changed locally, not yet pushed
};

function nowIso() {
  return new Date().toISOString();
}

export function uid() {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// persistence
// ---------------------------------------------------------------------------
export function load() {
  try {
    const raw = localStorage.getItem(LS_TASKS);
    state.tasks = raw ? JSON.parse(raw).tasks ?? [] : [];
  } catch {
    state.tasks = [];
  }
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    state.settings = raw ? { sync: null, ...JSON.parse(raw) } : { sync: null };
  } catch {
    state.settings = { sync: null };
  }
  try {
    const raw = localStorage.getItem(LS_DIRTY);
    state.dirty = new Set(raw ? JSON.parse(raw) : []);
  } catch {
    state.dirty = new Set();
  }
  purgeOldTombstones();
}

function persistNow() {
  localStorage.setItem(LS_TASKS, JSON.stringify({ tasks: state.tasks }));
  localStorage.setItem(LS_DIRTY, JSON.stringify([...state.dirty]));
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 150);
}

export function persistSettings() {
  localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(source) {
  for (const fn of listeners) fn(source);
}

// ---------------------------------------------------------------------------
// selectors
// ---------------------------------------------------------------------------
export function byId(id) {
  return state.tasks.find((t) => t.id === id);
}

export function visible(tasks = state.tasks) {
  return tasks.filter((t) => !t.deleted);
}

const PRI_RANK = { high: 0, medium: 1, low: 2 };

export function sortTasks(list) {
  return [...list].sort((a, b) => {
    const da = a.due ?? '9999';
    const db = b.due ?? '9999';
    if (da !== db) return da < db ? -1 : 1;
    const pa = PRI_RANK[a.priority] ?? 3;
    const pb = PRI_RANK[b.priority] ?? 3;
    if (pa !== pb) return pa - pb;
    return (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
  });
}

/** Open tasks in a column, sorted; done-but-unlogged appended (checked, in place). */
export function columnTasks(col) {
  const inCol = visible().filter((t) => t.col === col && !t.loggedAt);
  const open = sortTasks(inCol.filter((t) => t.status === 'open'));
  const done = inCol
    .filter((t) => t.status === 'done')
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  return [...open, ...done];
}

export function loggedTasks() {
  return visible()
    .filter((t) => t.status === 'done' && t.loggedAt)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
}

export function unloggedDoneCount() {
  return visible().filter((t) => t.status === 'done' && !t.loggedAt).length;
}

// ---------------------------------------------------------------------------
// mutations (every local mutation bumps updatedAt + marks dirty)
// ---------------------------------------------------------------------------
function touch(task) {
  task.updatedAt = nowIso();
  state.dirty.add(task.id);
}

export function addTask(fields) {
  const task = {
    id: uid(),
    title: fields.title || 'Uden titel',
    notes: fields.notes ?? '',
    priority: fields.priority ?? null,
    due: fields.due ?? null,
    dueTime: fields.dueTime ?? null,
    col: fields.col ?? 'inbox',
    status: 'open',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    completedAt: null,
    loggedAt: null,
    deleted: false,
  };
  state.tasks.push(task);
  state.dirty.add(task.id);
  persist();
  emit('local');
  return task;
}

export function updateTask(id, patch) {
  const task = byId(id);
  if (!task) return null;
  Object.assign(task, patch);
  touch(task);
  persist();
  emit('local');
  return task;
}

export function completeTask(id) {
  return updateTask(id, { status: 'done', completedAt: nowIso() });
}

export function reopenTask(id) {
  return updateTask(id, { status: 'open', completedAt: null, loggedAt: null });
}

/** Tempo's "Log completed items": sweep done-but-unlogged into the log. */
export function logCompleted() {
  const stamp = nowIso();
  let n = 0;
  for (const t of state.tasks) {
    if (!t.deleted && t.status === 'done' && !t.loggedAt) {
      t.loggedAt = stamp;
      touch(t);
      n++;
    }
  }
  if (n) {
    persist();
    emit('local');
  }
  return n;
}

export function deleteTask(id) {
  return updateTask(id, { deleted: true });
}

export function restoreTask(id) {
  return updateTask(id, { deleted: false });
}

function purgeOldTombstones() {
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  state.tasks = state.tasks.filter(
    (t) => !(t.deleted && t.updatedAt < cutoff && !state.dirty.has(t.id))
  );
}

// ---------------------------------------------------------------------------
// sync integration
// ---------------------------------------------------------------------------
/** Apply remote payloads (last-write-wins on updatedAt). Returns changed count. */
export function applyRemote(payloads) {
  let changed = 0;
  for (const p of payloads) {
    if (!p || !p.id) continue;
    const local = byId(p.id);
    if (!local) {
      state.tasks.push(p);
      changed++;
    } else if ((p.updatedAt ?? '') > (local.updatedAt ?? '')) {
      Object.assign(local, p);
      state.dirty.delete(p.id);
      changed++;
    }
  }
  if (changed) {
    persistNow();
    emit('remote');
  }
  return changed;
}

export function dirtyTasks() {
  return [...state.dirty].map(byId).filter(Boolean);
}

export function clearDirty(entries) {
  // entries: [{id, updatedAt}] snapshotted before push - only clear if unchanged since
  for (const e of entries) {
    const t = byId(e.id);
    if (t && t.updatedAt === e.updatedAt) state.dirty.delete(e.id);
  }
  persist();
}
