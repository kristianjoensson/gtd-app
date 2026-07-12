// parser.js - Danish natural-language parsing for quick capture.
// Turns "Ring til Lars i morgen, vigtigt" into
// { title: "Ring til Lars", due: "2026-07-13", priority: "high", ... }
//
// Pure module, no DOM. Deterministic when a `now` Date is passed in.

// JS \b does not work next to æ/ø/å, so we use explicit boundary lookarounds.
const B = '(?<![\\wæøåé])';
const E = '(?![\\wæøåé])';

const WEEKDAYS = {
  søndag: 0, mandag: 1, tirsdag: 2, onsdag: 3, torsdag: 4, fredag: 5, lørdag: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};
const WEEKDAY_ALT = Object.keys(WEEKDAYS).join('|');

const MONTHS = {
  januar: 0, februar: 1, marts: 2, april: 3, maj: 4, juni: 5, juli: 6,
  august: 7, september: 8, oktober: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, okt: 9, nov: 10, dec: 11,
};
const MONTH_ALT =
  'januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december|' +
  'jan|feb|mar|apr|jun|jul|aug|sep|okt|nov|dec';

const NUM_WORDS = {
  en: 1, et: 1, to: 2, tre: 3, fire: 4, fem: 5, seks: 6, syv: 7, otte: 8, ni: 9, ti: 10, fjorten: 14,
};

// Words that often sit right before a date and should be stripped with it.
const DATE_LEAD_RE = /(?<![\wæøåé])(?:deadline|frist|senest|inden|til|på|nu på|d\.|den)\s*$/i;

function re(src) {
  return new RegExp(src, 'ig');
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// Local-time YYYY-MM-DD (never toISOString - that shifts across midnight in UTC).
export function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(base, days) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

// Next occurrence of a weekday. Today counts as a hit unless nextWeek.
// "næste fredag" means Friday of NEXT week, even if this week's is ahead.
function nextWeekday(now, wd, nextWeek) {
  let delta = (wd - now.getDay() + 7) % 7;
  if (nextWeek) delta = delta === 0 ? 7 : delta + 7;
  return addDays(now, delta);
}

// ---------------------------------------------------------------------------
// Date patterns, tried in order. First hit wins.
// Each: { type, re, resolve(match, now) -> Date | null }
// ---------------------------------------------------------------------------
const DATE_PATTERNS = [
  {
    // 15/7 or 15/07 (Danish day/month order)
    re: () => re('(?<![\\d/])(\\d{1,2})/(\\d{1,2})(?![\\d/])'),
    resolve(m, now) {
      const day = +m[1], month = +m[2] - 1;
      if (day < 1 || day > 31 || month < 0 || month > 11) return null;
      let d = new Date(now.getFullYear(), month, day);
      if (d < addDays(now, 0)) d = new Date(now.getFullYear() + 1, month, day);
      return d.getDate() === day ? d : null;
    },
  },
  {
    // "15. juli", "15 jul", "3. august"
    re: () => re(B + '(\\d{1,2})\\.?\\s*(' + MONTH_ALT + ')' + E),
    resolve(m, now) {
      const day = +m[1], month = MONTHS[m[2].toLowerCase()];
      if (day < 1 || day > 31 || month == null) return null;
      let d = new Date(now.getFullYear(), month, day);
      if (d < addDays(now, 0)) d = new Date(now.getFullYear() + 1, month, day);
      return d.getDate() === day ? d : null;
    },
  },
  {
    // "d. 15", "den 15."
    re: () => re(B + '(?:d\\.|den)\\s*(\\d{1,2})\\.?' + '(?![\\d./])'),
    resolve(m, now) {
      const day = +m[1];
      if (day < 1 || day > 31) return null;
      let d = new Date(now.getFullYear(), now.getMonth(), day);
      if (day < now.getDate()) d = new Date(now.getFullYear(), now.getMonth() + 1, day);
      return d.getDate() === day ? d : null;
    },
  },
  {
    re: () => re(B + '(?:i\\s*overmorgen|iovermorgen)' + E),
    resolve: (m, now) => addDays(now, 2),
  },
  {
    re: () => re(B + '(?:i\\s*morgen(?:\\s+tidlig)?|imorgen|tomorrow)' + E),
    resolve: (m, now) => addDays(now, 1),
  },
  {
    re: () => re(B + '(?:i\\s*dag|idag|i\\s*aften|i\\s*eftermiddag|today|tonight)' + E),
    resolve: (m, now) => addDays(now, 0),
  },
  {
    // "næste uge" -> next Monday
    re: () => re(B + 'næste\\s+uge' + E),
    resolve: (m, now) => addDays(now, ((1 - now.getDay() + 7) % 7) || 7),
  },
  {
    // "om 3 dage", "om to uger", "om 14 dage"
    re: () => re(B + 'om\\s+(\\d+|' + Object.keys(NUM_WORDS).join('|') + ')\\s+(dage?|uger?)' + E),
    resolve(m, now) {
      const n = NUM_WORDS[m[1].toLowerCase()] ?? +m[1];
      if (!Number.isFinite(n) || n < 0 || n > 365) return null;
      return addDays(now, m[2].toLowerCase().startsWith('u') ? n * 7 : n);
    },
  },
  {
    // "(på) fredag", "næste fredag", "førstkommende tirsdag"
    re: () => re(B + '(?:(næste)\\s+|på\\s+|førstkommende\\s+)?(' + WEEKDAY_ALT + ')' + E),
    resolve(m, now) {
      return nextWeekday(now, WEEKDAYS[m[2].toLowerCase()], Boolean(m[1]));
    },
  },
  {
    // "i weekenden" -> coming Saturday (today if already the weekend)
    re: () => re(B + '(?:i\\s+)?weekenden' + E),
    resolve(m, now) {
      if (now.getDay() === 0 || now.getDay() === 6) return addDays(now, 0);
      return nextWeekday(now, 6, false);
    },
  },
];

// "kl. 14", "kl 9.30", "14:30"
const TIME_PATTERNS = [
  { re: () => re(B + 'kl\\.?\\s*(\\d{1,2})(?:[.:](\\d{2}))?' + E) },
  { re: () => re('(?<![\\d.:])(\\d{1,2}):(\\d{2})(?![\\d.:])') },
];

const PRI_PATTERNS = [
  { value: 'high', re: () => re(B + '(?:haster|asap|akut|kritisk|vigtigt|vigtig|høj\\s+prio(?:ritet)?|prio\\s*1)' + E) },
  { value: 'high', re: () => re('!{2,}') },
  { value: 'medium', re: () => re(B + '(?:mellem\\s+prio(?:ritet)?|medium)' + E) },
  { value: 'low', re: () => re(B + '(?:lav\\s+prio(?:ritet)?|lavt\\s+prioriteret|ikke\\s+vigtigt?|kan\\s+vente)' + E) },
];

// Someday-markers park the task in "Senere". Only honored at the END of the
// text, so "planlæg en dag i Berlin" keeps its title intact.
const LATER_RE = () => re(B + '(?:en\\s+dag|på\\s+et\\s+tidspunkt|someday|måske)[\\s.!?]*$');

function overlaps(a, b) {
  return a.index < b.index + b.length && b.index < a.index + a.length;
}

function extendLead(text, index) {
  const before = text.slice(0, index);
  const lead = before.match(DATE_LEAD_RE);
  return lead ? index - lead[0].length : index;
}

function firstMatch(text, patterns, now) {
  for (const p of patterns) {
    const rx = p.re();
    let m;
    while ((m = rx.exec(text)) !== null) {
      const resolved = p.resolve ? p.resolve(m, now) : true;
      if (resolved == null) continue;
      return { m, resolved, value: p.value };
    }
  }
  return null;
}

function stripSpans(text, spans) {
  const sorted = [...spans].sort((a, b) => b.index - a.index);
  let out = text;
  for (const s of sorted) {
    out = out.slice(0, s.index) + ' ' + out.slice(s.index + s.length);
  }
  out = out
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/^[\s,.;:!?–-]+/, '')
    .replace(/[\s,.;:–-]+$/, '')
    .trim();
  if (out) out = out[0].toUpperCase() + out.slice(1);
  return out;
}

/**
 * Parse a capture string.
 * @param {string} input raw text (typed or dictated)
 * @param {{now?: Date, disabled?: Set<string>}} opts
 *   disabled: match types ("due"|"time"|"priority"|"later") the user removed via chips.
 * @returns {{title, due, dueTime, priority, column, matches}}
 */
export function parse(input, opts = {}) {
  const now = opts.now ?? new Date();
  const disabled = opts.disabled ?? new Set();
  const text = String(input ?? '');
  const matches = [];
  const spans = [];

  let due = null;
  let dueTime = null;
  let priority = null;
  let column = 'inbox';

  // Later-marker first: it owns the tail of the string.
  const laterM = LATER_RE().exec(text);
  if (laterM) {
    const span = { index: laterM.index, length: laterM[0].length };
    matches.push({ type: 'later', text: laterM[0].trim(), ...span });
    if (!disabled.has('later')) {
      column = 'later';
      spans.push(span);
    }
  }

  const dateHit = firstMatch(text, DATE_PATTERNS, now);
  if (dateHit && !(laterM && overlaps({ index: dateHit.m.index, length: dateHit.m[0].length }, { index: laterM.index, length: laterM[0].length }))) {
    const start = extendLead(text, dateHit.m.index);
    const span = { index: start, length: dateHit.m.index + dateHit.m[0].length - start };
    matches.push({ type: 'due', text: dateHit.m[0].trim(), ...span, date: fmtDate(dateHit.resolved) });
    if (!disabled.has('due')) {
      due = fmtDate(dateHit.resolved);
      spans.push(span);
    }
  }

  const timeHit = firstMatch(text, TIME_PATTERNS, now);
  if (timeHit) {
    const h = +timeHit.m[1];
    const min = timeHit.m[2] != null ? +timeHit.m[2] : 0;
    if (h >= 0 && h < 24 && min >= 0 && min < 60) {
      const span = { index: timeHit.m.index, length: timeHit.m[0].length };
      if (!spans.some((s) => overlaps(s, span))) {
        matches.push({ type: 'time', text: timeHit.m[0].trim(), ...span, time: `${pad(h)}:${pad(min)}` });
        if (!disabled.has('time')) {
          dueTime = `${pad(h)}:${pad(min)}`;
          if (!due && !disabled.has('due')) due = fmtDate(now);
          spans.push(span);
        }
      }
    }
  }

  for (const p of PRI_PATTERNS) {
    const rx = p.re();
    const m = rx.exec(text);
    if (!m) continue;
    const span = { index: m.index, length: m[0].length };
    if (spans.some((s) => overlaps(s, span))) continue;
    matches.push({ type: 'priority', text: m[0].trim(), ...span, priority: p.value });
    if (!disabled.has('priority')) {
      priority = p.value;
      spans.push(span);
    }
    break;
  }

  const title = stripSpans(text, spans) || text.trim();
  return { title, due, dueTime, priority, column, matches };
}

// ---------------------------------------------------------------------------
// Display helpers (Danish)
// ---------------------------------------------------------------------------
const DAY_FMT = new Intl.DateTimeFormat('da-DK', { weekday: 'short', day: 'numeric', month: 'short' });

export function labelForDate(iso, now = new Date()) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((date - today) / 86400000);
  if (diff === 0) return 'i dag';
  if (diff === 1) return 'i morgen';
  if (diff === -1) return 'i går';
  return DAY_FMT.format(date);
}

export function dueState(iso, now = new Date()) {
  if (!iso) return 'none';
  const today = fmtDate(now);
  if (iso < today) return 'overdue';
  if (iso === today) return 'today';
  return 'future';
}
