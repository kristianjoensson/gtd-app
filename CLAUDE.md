# CLAUDE.md - Ro (personlig to-do PWA)

Personal project - Kristian's girlfriend's task app. NOT Creative Force, NOT Dreem.
Danish UI. Never apply CF/Dreem brand skills here; design follows `design-fundamentals` only.

## What it is

Zero-build vanilla JS PWA modeled on Tempo (the tasks feature in `marketing-team/`):
Indbakke → board columns (Næste / I gang / Senere) → done stays checked in place →
"Log færdige" sweeps to a day-grouped log. Priority (høj/mellem/lav = red/amber/green
stripe) and due date are parsed from natural Danish at capture time.

## Files

- `index.html` - app shell, all dialogs (task detail, settings)
- `js/parser.js` - Danish NL parser (dates, times, priority, someday). Pure module.
- `js/store.js` - state + localStorage + mutations + LWW merge for sync
- `js/sync.js` - Supabase REST sync (no SDK). Table `ro_tasks`, RLS via x-workspace-token header.
- `js/app.js` - rendering + events. Mobile = tabs (Fokus/Indbakke/Senere/Log), desktop ≥900px = 4-column board + log below.
- `sw.js` - network-first cache. Bump `CACHE` version when changing assets list.
- `tests/parser.test.mjs` - run `node tests/parser.test.mjs` (37 tests). Always run after touching parser.js.
- `SETUP.md` - Kristian-facing: deploy + Supabase SQL + device install.

## Run / verify

Dev server: launch config `ro-app` in root `.claude/launch.json` (python http.server, port 8764).
CSS gotcha: the desktop `@media (min-width: 900px)` block must stay LAST in styles.css
(equal-specificity overrides depend on source order).

## Decisions

- PWA over native: one codebase, no App Store, installs on iPhone (Add to Home Screen) and Windows (Edge/Chrome install).
- Sync is optional + local-first; configured at runtime in Settings (synk-kode = base64 of url/key/token). No secrets in the repo.
- Sort inside columns: due date, then priority, then age. No manual reorder in v1.
- Welcome task seeds once (`ro.seeded` flag), device-local until edited.

## Status log

- 2026-07-12: v1 built + verified in browser (mobile 375px + desktop 1280px, light/dark). Not yet deployed; Supabase not yet created. Danish parser: 37/37 tests green.
