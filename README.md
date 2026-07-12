# Ro

Fang det. Glem det trygt.

En rolig opgave-app til travle hoveder: skriv eller tal en opgave ind på dansk,
og Ro fanger selv deadline og prioritet. Virker på iPhone og Windows fra samme
webapp, offline, med valgfri synkronisering mellem enheder.

- **Capture:** "Ring til Lars i morgen kl. 14, vigtigt" → opgave "Ring til Lars",
  deadline i morgen 14:00, rød prioritet. Dansk (+ lidt engelsk).
- **Flow:** Indbakke → Næste / I gang / Senere → færdig → Log (grupperet pr. dag).
- **Noter** på hver opgave. Farvekode efter prioritet. Deadline-chips (rød = overskredet).
- **Ingen build, ingen dependencies.** Statisk mappe - host den hvor som helst med HTTPS.

Opsætning og deploy: se [SETUP.md](SETUP.md).
Test af parseren: `node tests/parser.test.mjs`.
