// Run: node tests/parser.test.mjs
// Fixed reference date: Sunday 2026-07-12.
import assert from 'node:assert/strict';
import { parse, labelForDate, dueState } from '../js/parser.js';

const now = new Date(2026, 6, 12, 10, 0, 0); // Sun 12 Jul 2026, 10:00 local
let passed = 0;
const failures = [];

function t(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push({ name, err });
  }
}

function p(input, opts = {}) {
  return parse(input, { now, ...opts });
}

// --- dates -----------------------------------------------------------------
t('i morgen', () => {
  const r = p('Ring til Lars i morgen');
  assert.equal(r.due, '2026-07-13');
  assert.equal(r.title, 'Ring til Lars');
});

t('imorgen (dictation, no space)', () => {
  assert.equal(p('køb mælk imorgen').due, '2026-07-13');
});

t('i dag', () => {
  const r = p('Send udkast i dag');
  assert.equal(r.due, '2026-07-12');
  assert.equal(r.title, 'Send udkast');
});

t('i overmorgen', () => {
  const r = p('Interview i overmorgen');
  assert.equal(r.due, '2026-07-14');
  assert.equal(r.title, 'Interview');
});

t('på fredag -> this coming Friday', () => {
  const r = p('Skriv artikel om valget på fredag');
  assert.equal(r.due, '2026-07-17');
  assert.equal(r.title, 'Skriv artikel om valget');
});

t('bare weekday', () => {
  assert.equal(p('Aflever kommentar torsdag').due, '2026-07-16');
});

t('næste fredag -> Friday next week', () => {
  assert.equal(p('Frokost med Mette næste fredag').due, '2026-07-24');
});

t('næste uge -> next Monday', () => {
  const r = p('Planlæg ferie næste uge');
  assert.equal(r.due, '2026-07-13');
  assert.equal(r.title, 'Planlæg ferie');
});

t('om 3 dage', () => {
  assert.equal(p('Følg op om 3 dage').due, '2026-07-15');
});

t('om to uger', () => {
  assert.equal(p('Genbesøg pitch om to uger').due, '2026-07-26');
});

t('15. juli', () => {
  const r = p('Aflever regnskab 15. juli');
  assert.equal(r.due, '2026-07-15');
  assert.equal(r.title, 'Aflever regnskab');
});

t('month in the past rolls to next year', () => {
  assert.equal(p('Nytårsforsæt 3. januar').due, '2027-01-03');
});

t('15/8 slash date', () => {
  assert.equal(p('Opfølgning 15/8').due, '2026-08-15');
});

t('d. 20 -> this month', () => {
  const r = p('Husk husleje d. 20');
  assert.equal(r.due, '2026-07-20');
  assert.equal(r.title, 'Husk husleje');
});

t('den 5 -> next month when passed', () => {
  assert.equal(p('Tandlæge den 5.').due, '2026-08-05');
});

t('senest torsdag strips the lead word', () => {
  const r = p('Send faktura senest torsdag');
  assert.equal(r.due, '2026-07-16');
  assert.equal(r.title, 'Send faktura');
});

t('inden onsdag strips the lead word', () => {
  const r = p('Aflever bog inden onsdag');
  assert.equal(r.title, 'Aflever bog');
  assert.equal(r.due, '2026-07-15');
});

t('i weekenden on a Sunday -> today', () => {
  assert.equal(p('Ryd op i weekenden').due, '2026-07-12');
});

t('english tomorrow', () => {
  assert.equal(p('call mom tomorrow').due, '2026-07-13');
});

// --- time ------------------------------------------------------------------
t('kl 14 + date', () => {
  const r = p('Interview kl 14 i overmorgen');
  assert.equal(r.due, '2026-07-14');
  assert.equal(r.dueTime, '14:00');
  assert.equal(r.title, 'Interview');
});

t('kl. 9.30', () => {
  const r = p('Book studie tirsdag kl. 9.30');
  assert.equal(r.due, '2026-07-14');
  assert.equal(r.dueTime, '09:30');
  assert.equal(r.title, 'Book studie');
});

t('bare 14:30 implies today', () => {
  const r = p('Redaktionsmøde 14:30');
  assert.equal(r.dueTime, '14:30');
  assert.equal(r.due, '2026-07-12');
});

// --- priority --------------------------------------------------------------
t('vigtigt -> high', () => {
  const r = p('Ring til kilden i morgen, vigtigt');
  assert.equal(r.priority, 'high');
  assert.equal(r.due, '2026-07-13');
  assert.equal(r.title, 'Ring til kilden');
});

t('haster -> high', () => {
  const r = p('Svar redaktøren haster');
  assert.equal(r.priority, 'high');
  assert.equal(r.title, 'Svar redaktøren');
});

t('!! -> high', () => {
  assert.equal(p('Deadline-tekst!!').priority, 'high');
});

t('kan vente -> low', () => {
  const r = p('Opdater CV kan vente');
  assert.equal(r.priority, 'low');
  assert.equal(r.title, 'Opdater CV');
});

t('lav prioritet -> low', () => {
  assert.equal(p('Sorter mails, lav prioritet').priority, 'low');
});

t('uvigtig does NOT trigger vigtig', () => {
  assert.equal(p('Slet uvigtige mails').priority, null);
});

// --- someday / senere --------------------------------------------------------
t('trailing "en dag" -> later column', () => {
  const r = p('Lær spansk en dag');
  assert.equal(r.column, 'later');
  assert.equal(r.title, 'Lær spansk');
});

t('mid-sentence "en dag" is kept', () => {
  const r = p('Planlæg en dag i Berlin til artiklen');
  assert.equal(r.column, 'inbox');
  assert.equal(r.title, 'Planlæg en dag i Berlin til artiklen');
});

t('trailing måske -> later', () => {
  assert.equal(p('Køb ny cykel måske').column, 'later');
});

// --- plain + edge ------------------------------------------------------------
t('no signals -> plain inbox task', () => {
  const r = p('Ryd op i noter');
  assert.deepEqual([r.due, r.priority, r.column], [null, null, 'inbox']);
  assert.equal(r.title, 'Ryd op i noter');
});

t('title is capitalized', () => {
  assert.equal(p('ring til lars').title, 'Ring til lars');
});

t('chip disable restores nothing but keeps title stripped only for active', () => {
  const r = p('Ring til Lars i morgen', { disabled: new Set(['due']) });
  assert.equal(r.due, null);
  assert.equal(r.title, 'Ring til Lars i morgen');
});

t('combined: date + time + priority', () => {
  const r = p('Send manus til forlaget på onsdag kl. 12, vigtigt');
  assert.equal(r.due, '2026-07-15');
  assert.equal(r.dueTime, '12:00');
  assert.equal(r.priority, 'high');
  assert.equal(r.title, 'Send manus til forlaget');
});

// --- spoken instructions (dictation) -----------------------------------------
t('spoken instruction phrase is data, not title', () => {
  const r = p('Husk frokost Sæt den her til tirsdag klokken 12');
  assert.equal(r.title, 'Husk frokost');
  assert.equal(r.due, '2026-07-14');
  assert.equal(r.dueTime, '12:00');
});

t('klokken as spoken time word', () => {
  const r = p('Ring til banken klokken 9.30');
  assert.equal(r.dueTime, '09:30');
  assert.equal(r.due, '2026-07-12');
  assert.equal(r.title, 'Ring til banken');
});

t('deadline er fredag', () => {
  const r = p('Aflever artikel deadline er fredag');
  assert.equal(r.title, 'Aflever artikel');
  assert.equal(r.due, '2026-07-17');
});

t('skal være færdig senest onsdag', () => {
  const r = p('Rapporten skal være færdig senest onsdag');
  assert.equal(r.title, 'Rapporten');
  assert.equal(r.due, '2026-07-15');
});

t('time and date first, filler dropped', () => {
  const r = p('Klokken 14 tirsdag skal jeg hente pakken');
  assert.equal(r.dueTime, '14:00');
  assert.equal(r.due, '2026-07-14');
  assert.equal(r.title, 'Hente pakken');
});

t('real til-phrases survive', () => {
  const r = p('Køb billetter til koncerten på fredag');
  assert.equal(r.title, 'Køb billetter til koncerten');
  assert.equal(r.due, '2026-07-17');
});

t('flyt mødet keeps its meaning', () => {
  const r = p('Flyt mødet til torsdag');
  assert.equal(r.title, 'Flyt mødet');
  assert.equal(r.due, '2026-07-16');
});

// --- labels ------------------------------------------------------------------
t('labelForDate', () => {
  assert.equal(labelForDate('2026-07-12', now), 'i dag');
  assert.equal(labelForDate('2026-07-13', now), 'i morgen');
  assert.match(labelForDate('2026-07-17', now), /fre/i);
});

t('dueState', () => {
  assert.equal(dueState('2026-07-11', now), 'overdue');
  assert.equal(dueState('2026-07-12', now), 'today');
  assert.equal(dueState('2026-08-01', now), 'future');
});

// -----------------------------------------------------------------------------
if (failures.length) {
  for (const f of failures) {
    console.error(`FAIL ${f.name}\n  ${f.err.message}`);
  }
  console.error(`\n${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`${passed} tests passed`);
