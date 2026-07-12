# Ro - opsætning (10-15 min, én gang)

Ro virker med det samme på én enhed (alt gemmes lokalt i browseren).
De to trin herunder giver hende: (1) en app på nettet begge enheder kan åbne,
(2) synkronisering mellem iPhone og Windows.

## Trin 1: Læg appen på nettet (ca. 5 min)

Appen er ren statisk HTML - ingen build. Alle tre muligheder virker; GitHub Pages er gratis og stabil.

**GitHub Pages (anbefalet):**
1. Opret et repo (fx `ro-app`) og push denne mappe.
2. Repo Settings → Pages → Source: `main` branch, root.
3. Appen ligger nu på `https://<bruger>.github.io/ro-app/`.

**Vercel/Netlify:** importer mappen som projekt, framework "Other", ingen build command, output = mappen selv.

HTTPS er et krav (ellers ingen "installér som app" og ingen offline-cache). Alle tre løsninger giver HTTPS automatisk.

## Trin 2: Opret sync-databasen (ca. 5 min)

1. Gå til [supabase.com](https://supabase.com) → New project (gratis tier, region `eu-central-1`).
2. Åbn **SQL Editor** og kør:

```sql
create table public.ro_tasks (
  id uuid primary key,
  workspace text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create index ro_tasks_ws_updated on public.ro_tasks (workspace, updated_at);

alter table public.ro_tasks enable row level security;

-- Adgang kræver at klienten sender selve workspace-nøglen som header.
-- Anon-nøglen alene kan hverken læse eller skrive noget.
create policy ro_select on public.ro_tasks for select to anon
  using (workspace = (current_setting('request.headers', true)::json->>'x-workspace-token'));

create policy ro_insert on public.ro_tasks for insert to anon
  with check (workspace = (current_setting('request.headers', true)::json->>'x-workspace-token'));

create policy ro_update on public.ro_tasks for update to anon
  using (workspace = (current_setting('request.headers', true)::json->>'x-workspace-token'))
  with check (workspace = (current_setting('request.headers', true)::json->>'x-workspace-token'));
```

3. Find **Project Settings → API**: kopiér `Project URL` og `anon public`-nøglen.
4. Åbn Ro → tandhjulet → Manuel opsætning: indsæt URL + anon-nøgle, tryk **Generér** (arbejdsområde-nøgle), så **Gem og forbind**.
5. Tryk **Kopiér synk-kode** og send koden til den anden enhed (fx via Beskeder).
6. På den anden enhed: tandhjulet → indsæt koden i **Synk-kode** → **Brug kode**. Færdig.

Synk kører automatisk: push ca. 1 sekund efter en ændring, pull hvert 20. sekund og hver gang appen får fokus. Konflikter afgøres pr. opgave med seneste ændring vinder.

## Installér på enhederne

**iPhone:** åbn appens URL i Safari → Del-knappen → **Føj til hjemmeskærm**. Ikonet "Ro" opfører sig som en app (fuldskærm, offline).

**Windows:** åbn URL'en i Chrome eller Edge → installations-ikonet i adresselinjen ("Installér Ro") → appen får eget vindue og ikon i proceslinjen. Alm. browserfane virker også.

## Diktering på dansk (iPhone)

To veje, begge på dansk:
- **Mikrofon-knappen i Ro** bruger talegenkendelse (kræver at Siri/diktering er slået til).
- **Mikrofonen på iOS-tastaturet** virker altid i tekstfeltet - tryk i feltet, tryk mic, tal.

## Sikkerhedsnote

Workspace-nøglen fungerer som adgangskode til opgaverne (128 bit tilfældig). Det er fint til huskelister og hverdagsopgaver. Skal appen bruges til følsomt kildemateriale, bør vi opgradere til rigtige Supabase-logins (magic link) - sig til, det er en lille udvidelse.
