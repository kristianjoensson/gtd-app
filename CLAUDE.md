# CLAUDE.md - GTD (personlig to-do PWA)

Personal project - Kristian's girlfriend's task app. NOT Creative Force, NOT Dreem,
and NOT Kristian's own task system (that is Tempo/`tasks.json` + the `gtm` skill at the
workspace root - do not mix the two, despite this app being named "GTD").
Danish UI. Never apply CF/Dreem brand skills here; design follows `design-fundamentals` only.

## What it is

Zero-build vanilla JS PWA modeled on Tempo (the tasks feature in `marketing-team/`):
Indbakke → board columns (Næste / I gang / Senere) → done stays checked in place →
"Log færdige" sweeps to a day-grouped log. Priority (høj/mellem/lav = red/amber/green
stripe) and due date are parsed from natural Danish at capture time.

## Files

- `index.html` - app shell, dialogs (task detail, settings/login)
- `js/parser.js` - Danish NL parser (dates, times, priority, someday). Pure module.
- `js/store.js` - state + localStorage + mutations + LWW merge for sync
- `js/sync.js` - auth (Supabase Auth via vendored supabase-js: Google OAuth + magic link) + REST sync against `gtd_tasks`, RLS on auth.uid()
- `js/config.js` - SUPABASE_URL + SUPABASE_ANON_KEY (empty = local-only mode; anon key is public by design)
- `js/vendor/supabase-js.js` - pinned UMD build of @supabase/supabase-js v2 (auth/session/refresh)
- `js/app.js` - rendering + events. Mobile = tabs (Fokus/Indbakke/Senere/Log), desktop ≥900px = 4-column board + log below.
- `sw.js` - network-first cache. Bump `CACHE` version when changing the assets list.
- `tests/parser.test.mjs` - run `node tests/parser.test.mjs` (44 tests). Always run after touching parser.js.
- `SETUP.md` - Kristian-facing: Supabase SQL, Google OAuth walkthrough, deploy, hosting facts.

## Run / verify

Dev server: launch config `gtd-app` in root `.claude/launch.json` (python http.server, port 8764).
CSS gotcha: the desktop `@media (min-width: 900px)` block must stay LAST in styles.css
(equal-specificity overrides depend on source order).
Auth flows need a real Supabase project (config.js filled) - the no-config path must
always degrade to local-only mode with the "ikke sat op" settings panel.

## Decisions

- PWA over native: one codebase, no App Store, installs on iPhone (Add to Home Screen) and Windows (Edge/Chrome install).
- Auth replaced the v1 workspace-token sync (2026-07-12, Kristian asked for real login). One account = one task list; login on both devices with the same account.
- On first login per device (or account switch) all local tasks are marked dirty and merge UP into the account; cursor resets. Account switching merges lists - documented tradeoff for a 1-user app.
- Sort inside columns: due date, then priority, then age. No manual reorder in v1.
- Welcome task seeds once (`gtd.seeded` flag), device-local until edited.

## Status log

- 2026-07-12: v1 built + verified in browser (mobile + desktop, light/dark). Parser 37/37.
- 2026-07-12: renamed Ro → GTD; sync rewritten to Supabase Auth (Google + magic link), table `gtd_tasks` per-user RLS; supabase-js vendored.
- 2026-07-12: DEPLOYED - public repo github.com/kristianjoensson/gtd-app, live at https://kristianjoensson.github.io/gtd-app/ (verified). Pending: Kristian creates the Supabase project, fills js/config.js, push redeploys automatically.
- 2026-07-12: Supabase project fhkykdaqvywrlsqsqpmq connected (publishable key in config.js, deployed + verified live: REST 200, RLS blocks anon, email login on, Google provider off). Pending: Kristian sets Auth URL Configuration + optional Google provider.
- 2026-07-12: login gate added - configured app shows ONLY the login screen until a session exists (body[data-auth] pending/out/in); sessions persist per device via supabase-js; welcome task now seeds after first sync and only into an empty account.
- 2026-07-12: switched from magic-link to 6-digit code login. Root cause: iOS installed home-screen apps have their own storage, separate from Safari, so a tapped link signed in over there and the installed app never saw the session. verifyEmailOtp() completes login inside the app itself. REQUIRES the Magic Link email template to include {{ .Token }} (SETUP.md trin 3) - Kristian must add this in the Supabase dashboard, cannot be done via anon key.
