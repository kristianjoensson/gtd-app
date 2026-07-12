// app.js - UI wiring: capture, board/tabs, task card, log, settings, toasts.

import { parse, labelForDate, dueState, fmtDate } from './parser.js';
import {
  COLUMN_LABEL, state, load, subscribe, byId, addTask, updateTask,
  completeTask, reopenTask, logCompleted, deleteTask, restoreTask,
  columnTasks, loggedTasks, unloggedDoneCount, visible, sortTasks,
} from './store.js';
import {
  initSync, pushSoon, sync, isConfigured, onFirstSync,
  signInWithGoogle, signOutUser,
} from './sync.js';

const $ = (sel) => document.querySelector(sel);
const GRACE_MS = 1600; // Tempo-style completion grace before the row leaves

const PRI_LABEL = { high: 'Høj', medium: 'Mellem', low: 'Lav' };

const ui = {
  tab: 'fokus',
  capture: { raw: '', disabled: new Set() },
  editingId: null,
  leaving: new Map(), // id -> timeout (grace period)
  listening: false,
};

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
load();
// Local-only mode seeds at boot; with login, the welcome task waits for the
// first sync so an already-populated account never gets a duplicate.
if (!isConfigured()) seedWelcome();
renderAll();
subscribe((source) => {
  renderAll();
  if (source === 'local') pushSoon();
});
onFirstSync(seedWelcome);
initSync(renderSyncDot);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

function seedWelcome() {
  if (localStorage.getItem('gtd.seeded')) return;
  localStorage.setItem('gtd.seeded', '1');
  if (state.tasks.length) return;
  addTask({
    title: 'Velkommen til GTD. Åbn mig',
    notes:
      'Sådan bruger du GTD:\n' +
      '1. Skriv eller tal en opgave i feltet øverst. GTD forstår dansk, fx "Ring til Lars i morgen, vigtigt".\n' +
      '2. Datoer og prioritet bliver fanget automatisk og vist som små brikker før du gemmer.\n' +
      '3. Tryk på cirklen for at gøre en opgave færdig. Tryk "Log færdige" under Log for at arkivere dem.\n' +
      '4. Åbn en opgave for at skrive noter, ligesom her.\n\n' +
      'God ro i hovedet :)',
    col: 'inbox',
  });
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------
function renderAll() {
  renderColumns();
  renderFokus();
  renderLog();
  renderCaptureChips();
  renderTabsState();
}

function renderColumns() {
  for (const col of ['inbox', 'next', 'doing', 'later']) {
    const host = $(`#col-${col}`);
    const tasks = columnTasks(col);
    host.replaceChildren(...tasks.map((t) => cardEl(t)));
    if (!tasks.length) host.append(emptyEl(col));
    const count = tasks.filter((t) => t.status === 'open').length;
    const countEl = $(`#count-${col}`);
    if (countEl) countEl.textContent = count ? String(count) : '';
  }
  const inboxOpen = columnTasks('inbox').filter((t) => t.status === 'open').length;
  const badge = $('#tab-inbox-badge');
  badge.hidden = !inboxOpen;
  badge.textContent = inboxOpen;
}

function emptyEl(col) {
  const div = document.createElement('div');
  div.className = 'empty';
  div.textContent = {
    inbox: 'Tomt. Godt gået ✨',
    next: 'Vælg 1-3 opgaver som de næste.',
    doing: 'Intet i gang lige nu.',
    later: 'Ting der kan vente ligger her.',
  }[col] ?? 'Tomt';
  return div;
}

function renderFokus() {
  const open = visible().filter((t) => t.status === 'open');
  const today = fmtDate(new Date());
  const due = sortTasks(open.filter((t) => t.due && t.due <= today && t.col !== 'doing' && t.col !== 'next'));
  const host = $('#fokus-due');
  host.replaceChildren();
  if (due.length) {
    const h = document.createElement('h2');
    h.className = 'col-title urgent';
    h.textContent = 'Deadline nu';
    const list = document.createElement('div');
    list.className = 'list';
    list.append(...due.map((t) => cardEl(t, { showOrigin: true })));
    host.append(h, list);
  }
  const doing = columnTasks('doing');
  const next = columnTasks('next');
  $('#fokus-doing').replaceChildren(...doing.map((t) => cardEl(t)));
  if (!doing.length) $('#fokus-doing').append(emptyEl('doing'));
  $('#fokus-next').replaceChildren(...next.map((t) => cardEl(t)));
  if (!next.length) $('#fokus-next').append(emptyEl('next'));
}

function cardEl(task, opts = {}) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.id = task.id;
  card.dataset.pri = task.priority ?? 'none';
  if (task.status === 'done') card.classList.add('is-done');
  if (ui.leaving.has(task.id)) card.classList.add('is-leaving');

  const check = document.createElement('button');
  check.className = 'check';
  check.type = 'button';
  check.setAttribute('role', 'checkbox');
  check.setAttribute('aria-checked', task.status === 'done' || ui.leaving.has(task.id) ? 'true' : 'false');
  check.setAttribute('aria-label', task.status === 'done' ? 'Genåbn' : 'Markér som færdig');
  check.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleComplete(task.id);
  });

  const body = document.createElement('div');
  body.className = 'card-body';

  const title = document.createElement('p');
  title.className = 'card-title';
  title.textContent = task.title;
  body.append(title);

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  if (task.due) {
    const chip = document.createElement('span');
    chip.className = `chip due-${dueState(task.due)}`;
    chip.textContent = labelForDate(task.due) + (task.dueTime ? ` kl. ${task.dueTime}` : '');
    meta.append(chip);
  }
  if (task.priority) {
    const chip = document.createElement('span');
    chip.className = `chip pri pri-${task.priority}`;
    chip.textContent = PRI_LABEL[task.priority];
    meta.append(chip);
  }
  if (task.notes?.trim()) {
    const n = document.createElement('span');
    n.className = 'chip subtle';
    n.textContent = 'Noter';
    meta.append(n);
  }
  if (opts.showOrigin) {
    const o = document.createElement('span');
    o.className = 'chip subtle';
    o.textContent = COLUMN_LABEL[task.col];
    meta.append(o);
  }
  if (meta.childNodes.length) body.append(meta);

  card.append(check, body);
  card.addEventListener('click', () => openTask(task.id));
  return card;
}

function renderLog() {
  const pending = unloggedDoneCount();
  const btn = $('#btn-log-done');
  btn.hidden = !pending;
  $('#log-pending-count').textContent = pending;

  const groups = new Map();
  for (const t of loggedTasks()) {
    const day = (t.completedAt ?? '').slice(0, 10);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(t);
  }
  const host = $('#log-groups');
  host.replaceChildren();
  $('#log-empty').hidden = groups.size > 0 || pending > 0;
  for (const [day, tasks] of groups) {
    const h = document.createElement('h2');
    h.className = 'col-title';
    h.textContent = logDayLabel(day);
    const list = document.createElement('div');
    list.className = 'list';
    for (const t of tasks) {
      const row = cardEl(t);
      row.classList.add('logged');
      list.append(row);
    }
    host.append(h, list);
  }
}

function logDayLabel(day) {
  const label = labelForDate(day);
  return label === 'i dag' ? 'I dag' : label === 'i går' ? 'I går' : label;
}

function renderTabsState() {
  document.body.dataset.tab = ui.tab;
  for (const btn of document.querySelectorAll('.tab')) {
    const active = btn.dataset.tab === ui.tab;
    btn.classList.toggle('active', active);
    if (active) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
}

function renderSyncDot() {
  // Login gate: only an active "signedout" state hides the app. Everything
  // else (incl. unconfigured local mode) shows it.
  document.body.dataset.auth = sync.status === 'signedout' ? 'out' : 'in';
  for (const el of document.querySelectorAll('.google-only')) {
    el.hidden = !sync.googleEnabled;
  }
  $('#google-unavailable-gate').hidden = sync.googleEnabled;
  $('#google-unavailable').hidden = sync.googleEnabled;
  const dot = $('#sync-dot');
  dot.dataset.status = sync.status;
  dot.title = {
    off: 'Synk ikke sat op',
    signedout: 'Ikke logget ind',
    idle: 'Synkronisering: klar',
    syncing: 'Synkroniserer…',
    ok: 'Synkroniseret',
    error: `Synk-fejl: ${sync.error ?? ''}`,
  }[sync.status] ?? '';
  if ($('#settings-dialog')?.open) renderAuthPanel();
}

// ---------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------
const captureInput = $('#capture-input');

captureInput.addEventListener('input', () => {
  ui.capture.raw = captureInput.value;
  ui.capture.disabled.clear();
  renderCaptureChips();
});

$('#capture-form').addEventListener('submit', (e) => {
  e.preventDefault();
  submitCapture();
});

captureInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    submitCapture();
  }
});

function currentParse() {
  return parse(ui.capture.raw, { disabled: ui.capture.disabled });
}

function renderCaptureChips() {
  const host = $('#capture-chips');
  host.replaceChildren();
  if (!ui.capture.raw.trim()) return;
  const r = currentParse();

  const addChip = (cls, text, type) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `chip removable ${cls}`;
    chip.innerHTML = `${text} <span aria-hidden="true">×</span>`;
    chip.setAttribute('aria-label', `Fjern: ${text}`);
    chip.addEventListener('click', () => {
      ui.capture.disabled.add(type);
      renderCaptureChips();
    });
    host.append(chip);
  };

  if (r.due) addChip(`due-${dueState(r.due)}`, `📅 ${labelForDate(r.due)}`, 'due');
  if (r.dueTime) addChip('subtle', `kl. ${r.dueTime}`, 'time');
  if (r.priority) addChip(`pri pri-${r.priority}`, PRI_LABEL[r.priority], 'priority');
  if (r.column === 'later') addChip('subtle', 'Senere', 'later');

  const preview = document.createElement('span');
  preview.className = 'chip-preview';
  preview.textContent = `→ ${r.title || '…'}`;
  host.append(preview);
}

function submitCapture() {
  const raw = captureInput.value.trim();
  if (!raw) return;
  const r = currentParse();
  addTask({
    title: r.title,
    priority: r.priority,
    due: r.due,
    dueTime: r.dueTime,
    col: r.column,
  });
  captureInput.value = '';
  ui.capture.raw = '';
  ui.capture.disabled.clear();
  renderCaptureChips();
  toast(`Tilføjet til ${COLUMN_LABEL[r.column]} ✓`);
  captureInput.focus();
}

// keyboard: "/" focuses capture (desktop)
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement === document.body) {
    e.preventDefault();
    captureInput.focus();
  }
});

// ---------------------------------------------------------------------------
// speech capture (da-DK)
// ---------------------------------------------------------------------------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const micBtn = $('#btn-mic');
let recognizer = null;

micBtn.addEventListener('click', () => {
  if (!SR) {
    toast('Ingen talegenkendelse her. Brug mikrofonen på tastaturet i stedet.');
    captureInput.focus();
    return;
  }
  if (ui.listening) {
    recognizer?.stop();
    return;
  }
  recognizer = new SR();
  recognizer.lang = 'da-DK';
  recognizer.interimResults = true;
  recognizer.continuous = false;
  const base = captureInput.value ? captureInput.value.trim() + ' ' : '';
  ui.listening = true;
  micBtn.classList.add('listening');
  recognizer.onresult = (e) => {
    let text = '';
    for (const res of e.results) text += res[0].transcript;
    captureInput.value = base + text;
    ui.capture.raw = captureInput.value;
    ui.capture.disabled.clear();
    renderCaptureChips();
  };
  recognizer.onerror = (e) => {
    if (e.error === 'not-allowed') toast('Giv adgang til mikrofonen i browserens indstillinger.');
    else if (e.error !== 'aborted' && e.error !== 'no-speech') toast('Talegenkendelse fejlede. Prøv igen.');
  };
  recognizer.onend = () => {
    ui.listening = false;
    micBtn.classList.remove('listening');
    captureInput.focus();
  };
  try {
    recognizer.start();
  } catch {
    ui.listening = false;
    micBtn.classList.remove('listening');
  }
});

// ---------------------------------------------------------------------------
// completion with grace period (Tempo behavior)
// ---------------------------------------------------------------------------
function toggleComplete(id) {
  const task = byId(id);
  if (!task) return;
  if (ui.leaving.has(id)) {
    clearTimeout(ui.leaving.get(id));
    ui.leaving.delete(id);
    renderAll();
    return;
  }
  if (task.status === 'done') {
    reopenTask(id);
    return;
  }
  const timer = setTimeout(() => {
    ui.leaving.delete(id);
    completeTask(id);
    toast('Opgave fuldført ✓', { label: 'Fortryd', fn: () => reopenTask(id) });
  }, GRACE_MS);
  ui.leaving.set(id, timer);
  renderAll();
}

// ---------------------------------------------------------------------------
// task detail dialog
// ---------------------------------------------------------------------------
const taskDialog = $('#task-dialog');
const titleField = $('#task-title');
const notesField = $('#task-notes');
let saveTimer = null;

function openTask(id) {
  const task = byId(id);
  if (!task) return;
  ui.editingId = id;
  titleField.value = task.title;
  notesField.value = task.notes ?? '';
  $('#task-due').value = task.due ?? '';
  $('#task-due-time').value = task.dueTime ?? '';
  $('#task-col').value = task.col;
  $('#task-check').setAttribute('aria-checked', task.status === 'done' ? 'true' : 'false');
  updatePriSeg(task.priority);
  $('#task-meta').textContent =
    `Oprettet ${labelForDate((task.createdAt ?? '').slice(0, 10))}` +
    (task.completedAt ? ` · Fuldført ${labelForDate(task.completedAt.slice(0, 10))}` : '');
  taskDialog.showModal();
  autoGrow(titleField);
  autoGrow(notesField);
}

function updatePriSeg(priority) {
  for (const btn of document.querySelectorAll('#task-priority-group .seg-btn')) {
    btn.classList.toggle('active', (btn.dataset.pri || null) === priority);
  }
}

function saveField(patch) {
  if (!ui.editingId) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => updateTask(ui.editingId, patch), 250);
}

titleField.addEventListener('input', () => {
  autoGrow(titleField);
  saveField({ title: titleField.value.trim() || 'Uden titel' });
});
notesField.addEventListener('input', () => {
  autoGrow(notesField);
  saveField({ notes: notesField.value });
});
$('#task-due').addEventListener('change', (e) => saveField({ due: e.target.value || null }));
$('#task-due-time').addEventListener('change', (e) => saveField({ dueTime: e.target.value || null }));
$('#task-due-clear').addEventListener('click', () => {
  $('#task-due').value = '';
  $('#task-due-time').value = '';
  saveField({ due: null, dueTime: null });
});
$('#task-col').addEventListener('change', (e) => saveField({ col: e.target.value }));

document.querySelector('#task-priority-group').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  const pri = btn.dataset.pri || null;
  updatePriSeg(pri);
  saveField({ priority: pri });
});

$('#task-check').addEventListener('click', () => {
  const task = byId(ui.editingId);
  if (!task) return;
  if (task.status === 'done') {
    reopenTask(task.id);
    $('#task-check').setAttribute('aria-checked', 'false');
  } else {
    completeTask(task.id);
    $('#task-check').setAttribute('aria-checked', 'true');
    taskDialog.close();
    toast('Opgave fuldført ✓', { label: 'Fortryd', fn: () => reopenTask(task.id) });
  }
});

$('#task-delete').addEventListener('click', () => {
  const id = ui.editingId;
  if (!id) return;
  taskDialog.close();
  deleteTask(id);
  toast('Opgave slettet', { label: 'Fortryd', fn: () => restoreTask(id) });
});

taskDialog.addEventListener('close', () => {
  clearTimeout(saveTimer);
  if (ui.editingId) {
    const task = byId(ui.editingId);
    if (task) {
      const patch = {};
      const title = titleField.value.trim() || 'Uden titel';
      if (title !== task.title) patch.title = title;
      if (notesField.value !== task.notes) patch.notes = notesField.value;
      if (Object.keys(patch).length) updateTask(ui.editingId, patch);
    }
  }
  ui.editingId = null;
});

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

// ---------------------------------------------------------------------------
// tabs + log
// ---------------------------------------------------------------------------
for (const btn of document.querySelectorAll('.tab')) {
  btn.addEventListener('click', () => {
    ui.tab = btn.dataset.tab;
    renderTabsState();
    window.scrollTo({ top: 0 });
  });
}

$('#btn-log-done').addEventListener('click', () => {
  const n = logCompleted();
  toast(`${n} ${n === 1 ? 'opgave' : 'opgaver'} logget`);
});

// ---------------------------------------------------------------------------
// settings dialog
// ---------------------------------------------------------------------------
const settingsDialog = $('#settings-dialog');

$('#btn-settings').addEventListener('click', () => {
  renderAuthPanel();
  $('#sync-status-text').textContent = '';
  settingsDialog.showModal();
});

$('#settings-close').addEventListener('click', () => settingsDialog.close());

function renderAuthPanel() {
  const configured = isConfigured();
  const signedIn = Boolean(sync.user);
  $('#auth-unconfigured').hidden = configured;
  $('#auth-signedout').hidden = !configured || signedIn;
  $('#auth-signedin').hidden = !configured || !signedIn;
  if (signedIn) $('#auth-user').textContent = sync.user;
  renderSettingsStatus();
}

async function startGoogle(statusEl) {
  statusEl.textContent = 'Sender dig til Google…';
  const { error } = await signInWithGoogle();
  if (error === 'GOOGLE_DISABLED') {
    statusEl.textContent = 'Google-login er ikke aktiveret lige nu. Prøv igen senere.';
  } else if (error) {
    statusEl.textContent = `Login fejlede: ${error}`;
  }
}

$('#btn-google').addEventListener('click', () => startGoogle($('#sync-status-text')));
$('#btn-google-gate').addEventListener('click', () => startGoogle($('#login-status')));

$('#btn-signout').addEventListener('click', async () => {
  await signOutUser();
  settingsDialog.close();
  toast('Logget ud. Opgaverne bliver på enheden.');
});

function renderSettingsStatus() {
  const el = $('#sync-status-text');
  const dlg = $('#settings-dialog');
  if (!el || !dlg?.open) return;
  if (sync.status === 'error') el.textContent = `Synk-fejl: ${sync.error}`;
  else if (sync.status === 'ok') el.textContent = 'Synkroniseret ✓';
}

// close dialogs on backdrop click
for (const dlg of [taskDialog, settingsDialog]) {
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
}

// ---------------------------------------------------------------------------
// toast
// ---------------------------------------------------------------------------
function toast(message, action = null) {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = 'toast';
  const span = document.createElement('span');
  span.textContent = message;
  el.append(span);
  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      action.fn();
      el.remove();
    });
    el.append(btn);
  }
  root.append(el);
  setTimeout(() => {
    el.classList.add('gone');
    setTimeout(() => el.remove(), 300);
  }, 4200);
}
