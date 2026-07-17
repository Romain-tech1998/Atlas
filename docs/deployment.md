# Production deployment — Vercel + Neon

Sprint-039 gets Atlas onto a real, always-on URL reachable from a phone, not
just `localhost`. Hosting is **Vercel** (auto-detects Next.js, and Auth.js v5
auto-trusts the request host when it sees the `VERCEL` env var — confirmed
against [Auth.js's own deployment docs](https://authjs.dev/getting-started/deployment)
at implementation time, not assumed); the production database is **Neon**
(managed Postgres with native `pgvector` support), replacing the local
`docker-compose.yml` Postgres for production traffic only. Local dev and CI
keep using Docker exactly as they do today (Sprint-035) — nothing about them
changes.

Everything in this doc from **step 1 onward is account-creation and
dashboard work only Romain can do** — Claude Code has no way to create a
Vercel/Neon account, link OAuth, or click buttons in someone else's
dashboard, and per this project's standing rule, an AI agent should never be
handed real API keys/secrets to type into a form on your behalf either. What
Claude Code *did* do this sprint, before this doc: fixed a real gap where
`prisma generate` was never explicitly run before `next build` (see
`package.json`'s `build` script) — locally this never mattered because
`prisma db push`/`migrate` auto-regenerate the client as a side effect, but
a fresh Vercel build never runs those commands, so without this fix the
first deploy would have failed with "cannot find module
`@/generated/prisma/client`" or similar. Verified by deleting
`src/generated/prisma` entirely and confirming `npm run build` regenerates
it from a clean state.

## 1. Create the Neon project (do this before Vercel, since you'll need the connection string for step 4)

1. Go to [neon.tech](https://neon.tech) and create an account/project (a
   database named `atlas_prod` or similar; region close to you).
2. Neon has no per-extension dashboard toggle — enable `pgvector` by running
   this once in Neon's own SQL Editor (confirmed against
   [Neon's pgvector docs](https://neon.com/docs/extensions/pgvector) at
   implementation time):
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
3. Copy the connection string Neon shows you (it looks like
   `postgresql://<user>:<password>@<host>/<db>?sslmode=require`). You'll
   need it in steps 2 and 4 below — treat it exactly like a password: never
   paste it into a chat with an AI assistant, never commit it, only paste it
   into Neon's/Vercel's own dashboards.

## 2. Push the schema to Neon (one-time, from your own terminal)

From a local terminal (not through Claude Code, since this is a real
secret):

```
DATABASE_URL="<your neon connection string>" npx prisma db push
```

Then confirm the `Document.embedding` column actually landed as a real
`vector(1024)` column — the same verification Sprint-035 did against local
dev Postgres, since `prisma db push` handling `Unsupported("vector(N)")`
columns correctly against Neon specifically should be confirmed, not
assumed just because it worked locally. Run this in Neon's SQL Editor (or
`psql` against the same connection string):

```sql
SELECT column_name, udt_name
FROM information_schema.columns
WHERE table_name = 'Document' AND column_name = 'embedding';
```

Expect `udt_name = vector`. If a schema push against a *fresh* Neon database
is your first-ever push, `pgvector`'s extension (step 1) must have already
been created in that same database — the column type resolves at push
time, not lazily.

## 3. Create the Vercel project

1. Go to [vercel.com](https://vercel.com), sign up (GitHub sign-in is the
   easiest path since the repo is already on GitHub) and import the
   `Romain-tech1998/Atlas` repository as a new project.
2. Vercel auto-detects Next.js and proposes the standard build settings
   (`npm run build` / `.next` output) — accept the defaults.
3. **Do not deploy yet.** The first build will succeed (per Sprint-032's own
   finding, `next build` needs no real secrets), but the deployed app
   serving real requests will fail immediately without `DATABASE_URL`/
   `AUTH_SECRET` — set every env var below first.

## 4. Environment variables (Vercel project settings → Environment Variables)

Every value below is a real secret — enter it directly into Vercel's own
dashboard, never into a file that gets committed, and never paste a real
value into a chat with Claude Code. This mirrors the exact list in
`.env.example`, with `TEST_DATABASE_URL` deliberately excluded (dev/CI-only).

| Variable | Production value |
| --- | --- |
| `DATABASE_URL` | The Neon connection string from step 1 |
| `AUTH_SECRET` | Generate a fresh one — `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` (do **not** reuse your local `.env`'s value) |
| `ANTHROPIC_API_KEY` | Your real key from [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| `VOYAGE_API_KEY` | Your real key from [dash.voyageai.com](https://dash.voyageai.com) |
| `ATLAS_TOKEN_ENCRYPTION_KEY` | Generate a fresh one — same command as `AUTH_SECRET`, a separate random value |
| `GOOGLE_CALENDAR_CLIENT_ID` | From your Google Cloud OAuth client (see `docs/google-calendar-setup.md`) |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Same OAuth client |
| `GOOGLE_CALENDAR_REDIRECT_URI` | `https://<your-project>.vercel.app/api/providers/google-calendar/callback` — see the note below, since the domain isn't known until after the first deploy |

**The Google redirect URI is a two-step, chicken-and-egg update:** Vercel
only assigns your `*.vercel.app` domain once the project exists, so:
1. Deploy once first (step 5) with `GOOGLE_CALENDAR_REDIRECT_URI` temporarily
   left as any placeholder value, or skip setting it and accept Calendar
   connect won't work yet.
2. Once you know the real domain, set `GOOGLE_CALENDAR_REDIRECT_URI` to
   `https://<domain>/api/providers/google-calendar/callback` in Vercel, **and**
   add that exact same URI to the Google Cloud Console OAuth client's
   **Authorized redirect URIs** allow-list (`docs/google-calendar-setup.md`
   step 3) — both sides must match, or Calendar connect fails with a
   redirect-mismatch error.
3. Redeploy (or just save the env var — Vercel prompts a redeploy).

If Google Calendar isn't something you actually use day-to-day, it's fine to
skip this and note it as "not yet reconfigured for production" — the rest of
Atlas works independently of it.

## 5. First real deploy

With every env var set, trigger the deploy (push to `main`, or Vercel's own
"Deploy" button). **Read the build log, don't just glance at the checkmark**
— the same discipline every CI run has gotten since Sprint-032. Confirm:
- The install step completes and `prisma generate` runs (now automatic via
  the `build` script's `prisma generate && next build`).
- `next build`'s route list matches what `npm run build` shows locally.
- No secret value is echoed anywhere in the log — spot-check this
  specifically, the same vigilance this project's very first `git push` to
  GitHub got.

## 6. Live smoke test — from an actual phone

This is the sprint's real Definition of Done. Open the Vercel URL on your
phone's browser **on cellular data, not the same Wi-Fi as any dev machine**
— confirms it's genuinely public. Walk through:
- [ ] Create an account and log in
- [ ] Create a Mission
- [ ] Confirm a Decision reaches a Verdict
- [ ] Press the AI research button ("Rechercher des options réelles") and
      confirm it returns real, sourced options (uses production
      `ANTHROPIC_API_KEY`)
- [ ] Save a Document, then use Document semantic search and confirm a
      relevant question returns a match (uses production `VOYAGE_API_KEY`)
- [ ] If you use Google Calendar: connect it and confirm events load, using
      the production redirect URI from step 4

Report back honestly if any step doesn't work — a URL that loads but hasn't
been walked through on a real phone isn't actually done yet.

## Out of scope (deliberately, this sprint)

- PWA manifest/icons/"Add to Home Screen" — Sprint-040, once there's a real
  URL to test installability against.
- A custom domain — Vercel's free `*.vercel.app` subdomain is enough for
  personal daily use.
- Any change to `docker-compose.yml`/local dev or CI — production
  intentionally uses a separate Postgres (Neon) from local dev and CI
  (Docker), the same clean separation this project has kept since
  Sprint-024.
