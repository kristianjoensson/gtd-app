# GTD - opsætning (ca. 20 min, én gang)

GTD virker med det samme på én enhed (alt gemmes lokalt i browseren).
Trinene her giver: en app-URL begge enheder kan åbne, login med Google eller
mail-link, og automatisk synkronisering af opgaverne.

## Hvad er Supabase, og er det gratis?

Supabase er en hostet Postgres-database med login og API ovenpå - open source-alternativet til Googles Firebase. Den gemmer opgaverne og står for Google/mail-login. Free tier: 500 MB database, 50.000 aktive login-brugere pr. måned, ubegrænsede API-kald inden for fair use. En to-personers opgaveliste bruger under 1 promille af det. Eneste catch: gratis projekter går i dvale efter en uges inaktivitet og vågner ved første kald (få sekunders ventetid) - med daglig brug sker det ikke.

Supabase hoster kun data, ikke selve appen. Appen ligger på GitHub Pages (også gratis).

## Trin 1: Supabase-projekt (5 min)

1. [supabase.com](https://supabase.com) → New project (region `eu-central-1`).
2. **SQL Editor** → kør:

```sql
create table public.gtd_tasks (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create index gtd_tasks_user_updated on public.gtd_tasks (user_id, updated_at);

alter table public.gtd_tasks enable row level security;

create policy gtd_select on public.gtd_tasks for select to authenticated
  using (user_id = auth.uid());
create policy gtd_insert on public.gtd_tasks for insert to authenticated
  with check (user_id = auth.uid());
create policy gtd_update on public.gtd_tasks for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

Hver bruger ser kun sine egne rækker (RLS på `auth.uid()`). Anon-nøglen alene giver ingen adgang til data.

## Trin 2: Nøgler ind i appen (2 min)

**Project Settings → API**: kopiér `Project URL` og `anon public`-nøglen ind i
[js/config.js](js/config.js), commit og push. Anon-nøglen er designet til at være offentlig -
adgang styres af login + RLS, ikke af nøglen.

Under **Authentication → URL Configuration**: sæt Site URL til appens adresse
(fx `https://kristianjoensson.github.io/gtd-app/`) og tilføj samme adresse under Redirect URLs.

## Trin 3: Login-metoder

**Mail-link (virker med det samme, 0 opsætning):** Supabase sender et login-link pr. mail.
Hun skriver sin mail i appen → trykker på linket i mailen på samme enhed → logget ind.
Gratis-tierens indbyggede mailafsender er begrænset til få mails i timen - rigeligt, da
login kun sker én gang pr. enhed (sessionen fornyes selv bagefter).

**Google-login (pænest, ca. 10 min opsætning):**

Idéen: Google udsteder et sæt nøgler (Client ID + Client secret) til dit Supabase-projekt,
og Supabase får nøglerne indsat. Del A skaber nøglerne, Del B indsætter dem. Appen skal
ikke ændres - knappen virker i samme sekund, du trykker Save i Del B.

*Del A - Google Cloud Console (skab nøglerne):*

1. Gå til [console.cloud.google.com](https://console.cloud.google.com) og log ind med din Google-konto.
2. Klik projekt-vælgeren øverst til venstre → **New project** → navn `GTD` → Create → vælg projektet, når det er klar.
3. Menu (☰) → **APIs & Services** → **OAuth consent screen** (kaldes også "Google Auth Platform").
   - User type: **External** → Create.
   - App name: `GTD`. User support email: din mail. Developer contact: din mail. Resten kan springes over - klik Save and continue igennem.
   - Find **Test users** (ligger under "Audience" i det nye design): tilføj din Gmail OG hendes Gmail. Alternativ: klik **Publish app**, så kan alle Google-konti logge ind (fint, data er stadig pr. konto).
4. **APIs & Services** → **Credentials** → **+ Create credentials** → **OAuth client ID**.
   - Application type: **Web application**. Name: `GTD`.
   - **Authorized JavaScript origins** → Add URI, indsæt præcis:
     `https://fhkykdaqvywrlsqsqpmq.supabase.co`
   - **Authorized redirect URIs** → Add URI, indsæt præcis:
     `https://fhkykdaqvywrlsqsqpmq.supabase.co/auth/v1/callback`
   - Klik **Create**. En boks viser **Client ID** og **Client secret** - lad den stå åben til Del B.

*Del B - Supabase (indsæt nøglerne):*

5. Åbn [Authentication → Providers](https://supabase.com/dashboard/project/fhkykdaqvywrlsqsqpmq/auth/providers) → fold **Google** ud.
6. Slå **Enable Sign in with Google** til.
7. Indsæt **Client ID** og **Client secret** fra boksen i Del A.
8. Klik **Save**.

*Del C - test:* åbn appen → **Log ind med Google** → vælg konto → du lander tilbage i appen, logget ind.

*Fejlsøgning:*
- "provider is not enabled" → Del B blev ikke gemt (eller Enable-knappen er slået fra).
- "redirect_uri_mismatch" → redirect-URI'en i punkt 4 er ikke tegn-for-tegn `https://fhkykdaqvywrlsqsqpmq.supabase.co/auth/v1/callback`.
- "Access blocked: app has not completed verification" → mailen der logger ind mangler under Test users (punkt 3) - tilføj den, eller tryk Publish app.

Begge metoder giver samme konto-model: én konto = én opgaveliste, synk på tværs af alle enheder hvor hun er logget ind. I logger bare ind med hver jeres konto, hvis I begge vil bruge appen.

## Trin 4: Installér på enhederne

**iPhone:** åbn app-URL'en i Safari → Del → **Føj til hjemmeskærm**. Fuldskærm, eget ikon, virker offline.

**Windows:** åbn URL'en i Chrome/Edge → installations-ikonet i adresselinjen ("Installér GTD") → eget vindue + ikon i proceslinjen.

## Hosting-fakta (GitHub Pages og "privat")

- Selve **sitet** på GitHub Pages er altid offentligt tilgængeligt for den der kender URL'en. Det kan ikke gøres privat uden GitHub Enterprise.
- **Repoet** kan være privat, men Pages fra et privat repo kræver betalt GitHub-plan (Pro, ca. 4 USD/md). På gratis-plan skal repoet være offentligt for at Pages virker.
- Det er ok: URL'en viser kun app-skallen. Uden login kan ingen se eller røre data. Det er samme model som alle web-apps med login.
- Vil man absolut have URL'en bag adgangskontrol: Cloudflare Pages + Cloudflare Access (gratis op til 50 brugere) - kan sættes op senere uden app-ændringer.

## Diktering på dansk (iPhone)

- Mikrofon-knappen i GTD bruger talegenkendelse (kræver Siri/diktering slået til).
- Mikrofonen på iOS-tastaturet virker altid i tekstfeltet.
