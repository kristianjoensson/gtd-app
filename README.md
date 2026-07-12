# GTD

Fang det. Glem det trygt.

En rolig opgave-app til travle hoveder: skriv eller tal en opgave ind på dansk,
og GTD fanger selv deadline og prioritet. Virker på iPhone og Windows fra samme
webapp, offline, med login (Google eller mail-link) og automatisk synkronisering.

- **Capture:** "Ring til Lars i morgen kl. 14, vigtigt" → opgave "Ring til Lars",
  deadline i morgen 14:00, rød prioritet. Dansk (+ lidt engelsk).
- **Flow:** Indbakke → Næste / I gang / Senere → færdig → Log (grupperet pr. dag).
- **Noter** på hver opgave. Farvekode efter prioritet. Deadline-chips (rød = overskredet).
- **Login + synk:** Supabase Auth (Google eller magic link), data bag row-level security.
- **Ingen build.** Statisk mappe + én vendoret fil (supabase-js). Host hvor som helst med HTTPS.

Opsætning og deploy: se [SETUP.md](SETUP.md).
Test af parseren: `node tests/parser.test.mjs`.
