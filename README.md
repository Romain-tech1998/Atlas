# Atlas

An AI operating system for everyday life assistance. A user states a goal,
Atlas turns it into a **Mission**, and every update toward that mission runs
through Atlas Brain's pipeline of engines — structured, scored, planned.

- **Home** (`/home`) is the front door: a welcoming prompt when you have no
  missions, or your mission cards when you do. This is the primary
  experience — not a chatbot, not a dashboard.
- **Mission** (`/missions/[id]`) is a persistent goal that groups every
  `AxisRequest` made toward it. It always knows three things: what it is,
  how far along it is (momentum, not a fabricated percentage — Atlas doesn't
  do long-horizon planning yet), and what to do next (the latest
  `ExecutionPlan`'s first step, or what's blocking it).
- **Axis** — the pipeline that turns raw text into a structured, actionable
  object. Currently deterministic, rule-based mocks standing in for future
  LLM-backed engines.
- **Atlas Brain** (`src/brain/`) — nine independent, pure-where-possible
  engines chained by `src/services/atlasBrain.ts`:

  ```
  raw input → axisParser → intentEngine → entityEngine → contextEngine
    → atlasStateEngine → routingEngine → planningEngine → scoringEngine
    → learningEngine → save → response
  ```

  | Engine | Folder | Job |
  | --- | --- | --- |
  | Intent | `brain/intent/` | classifies the request (pure) |
  | Entity | `brain/entity/` | extracts title/dueDate/keywords (pure) |
  | Context | `brain/context/` | pulls relevant Memory/AtlasState/Mission/Task (repository + pure ranking) |
  | State | `brain/state/` | computes the user's next `AtlasState` snapshot (repository + pure transition) |
  | Routing | `brain/routing/` | picks the owning module + fallbacks (pure) |
  | Planning | `brain/planning/` | builds an `ExecutionPlan` (pure) |
  | Scoring | `brain/scoring/` | scores every stage + an overall score (pure) |
  | Memory | `brain/memory/` | derives + persists new memories (pure + repository) |
  | Learning | `brain/learning/` | derives + persists `LearningSignal`s (pure + repository) |

  Only the repositories (`*Repository.ts`) touch Prisma. Everything else in
  `src/brain/` is a pure function of its inputs. `src/services/missionService.ts`
  sits one layer above the Brain — it groups Brain output into Missions but
  isn't part of the Brain pipeline itself (Atlas Brain doesn't know Missions
  exist).

- **Modules** — `task`, `memory`, `document`, `conversation`. Axis routes and
  plans for a module; it doesn't yet execute module-specific logic (no real
  `Task`/`Document` rows are created from a plan yet — Skills/Skill Engine,
  per RFC-0003, are the intended path to closing that gap).

## i18n (English / French)

The presentation layer is fully bilingual via [next-intl](https://next-intl.dev)
(v4, verified compatible with Next 16 App Router + React 19 before install).
No URL prefix (`/en/`, `/fr/`) — the locale lives in a `atlas_locale` cookie,
set by the switcher in `AppNav` (`POST /api/locale`), read server-side in
`src/i18n/request.ts` (falls back to `Accept-Language`, then English).

- `messages/en.json` / `messages/fr.json` — one namespace per screen/domain
  (`home`, `mission`, `axis`, `dashboard`, `opportunity`, plus `planStep` /
  `routingReasoning` / `axisSummary` for Atlas Brain's own prose). ICU
  `select`/`plural` used throughout (e.g. `mission.currentFocus.needsField`).
- **`LocalizedText`** (`src/i18n/message.ts`) — `{ key, params? }`. Atlas
  Brain and the services never call a translator; they return this shape and
  the presentation layer resolves it with `renderLocalized(t, text)`
  (`src/i18n/render.ts`). This is what lets `routingEngine`/`planningEngine`
  reasoning, mission titles, and plan steps be genuinely translated instead
  of hardcoded English, without changing any decision logic.
- Persistence: `AxisRequest.summary`, `AxisDecision.reasoning`, and
  `Mission.title` are unchanged `String` columns that now hold a
  JSON-encoded `LocalizedText` (`src/i18n/persisted-text.ts`). Rows written
  before i18n hold plain English text; those decode as raw passthrough
  (`_raw` key) instead of crashing — same treatment applies to nested Json
  fields (`AxisRequest.executionPlan.steps[].description`,
  `contextSnapshot.recentMissions[].title`), normalized on read in
  `axisRequestRepository.ts`.
- **Known limitation, not fixed here:** the deterministic Intent Engine
  (`brain/intent/intentEngine.ts`) only recognizes English trigger phrases,
  and `entityEngine.ts`'s date keywords are English-only. Translating those
  is out of scope (would mean modifying Atlas Brain's matching logic, not
  just its output shape), so the Home page's example prompts and Axis's
  input placeholder stay in literal English in both locales — French UI
  transparently labels them as such.

## Architecture RFCs

Architecture decisions are drafted in `/docs/rfc` before they're folded into
this README. See [`docs/rfc/RFC-0001-Atlas-Core-Architecture.md`](docs/rfc/RFC-0001-Atlas-Core-Architecture.md)
for the target architecture (Axis, Atlas Brain, Skills, Modules, Interfaces)
and the product rules that constrain it.

## Stack

Next.js (App Router) · TypeScript (strict) · Tailwind CSS · shadcn/ui ·
Prisma 7 (`@prisma/adapter-pg`) · PostgreSQL · Auth.js v5 (Credentials
provider, JWT sessions)

## Setup

1. **Database.** Point `DATABASE_URL` in `.env` at a Postgres instance. For a
   throwaway local one with no other install required:

   ```bash
   npx prisma dev --detach
   ```

   This prints a connection string — put the plain `postgres://...` one (not
   the `prisma+postgres://` one) into `.env`.

2. **Install deps, generate the client, sync the schema:**

   ```bash
   npm install
   npx prisma generate
   npx prisma db push      # or: npx prisma migrate dev --name init
   ```

3. **Seed a demo user:**

   ```bash
   npx tsx prisma/seed.ts
   ```

   Creates `demo@atlas.local` / `atlas-demo-1234`.

4. **Run it:**

   ```bash
   npm run dev
   ```

   Visit `http://localhost:3000` — it redirects to `/login`, then `/home`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Typecheck |
| `npx prisma studio` | Browse the database |

## Structure

```
src/
  app/
    login/                       sign-in page (Credentials provider), no nav
    (app)/                        shared authenticated layout + nav
      layout.tsx                   auth check + AppNav (Home/Dashboard/Axis)
      home/                         empty-state hero or mission cards
      missions/[id]/                 mission hero, timeline, update input, actions
      dashboard/                    aggregate stats + recent Axis requests
      axis/                          raw pipeline debug view (AxisInput + full result)
    api/
      auth/[...nextauth]/          Auth.js route handler
      axis/parse/                   POST rawInput -> runs the pipeline standalone
      missions/                      POST create a mission (+ first pipeline run)
      missions/[id]/updates/          POST another pipeline run toward a mission
      missions/[id]/status/            POST mark complete/abandoned
  brain/                          the 9 Atlas Brain engines (see table above)
    types.ts                       AxisPipelineResult — the composed output
    intent/ entity/ context/ state/ routing/ planning/ scoring/ memory/ learning/
  components/
    ui/                           shadcn/ui primitives
    axis/                          AxisInput (reused by mission flows too), AxisResultCard + sub-views
    mission/                        MissionCard, MissionHero, MissionTimeline, MissionActions
    nav/                            AppNav
  domain/
    axis.ts                        shared module/intent id vocabulary
    mission.ts                      MissionSummary and its derived shapes
  services/
    axisParser.ts                   normalizes raw input (no I/O)
    atlasBrain.ts                    orchestrates the pipeline end to end
    axisRequestRepository.ts         Prisma access for AxisRequest/AxisDecision
    missionRepository.ts             Prisma access for Mission
    missionService.ts                orchestrates mission creation/updates + pure summary derivation
    dashboardStats.ts                pure aggregation for the dashboard
  lib/
    prisma.ts                       Prisma client (pg driver adapter)
    relative-time.ts                 pure "3 hours ago" formatting
  auth.ts                           Auth.js config
prisma/
  schema.prisma                     User, Memory, AxisRequest, AxisDecision,
                                     LearningSignal, Mission, Task, Document,
                                     AtlasState
  seed.ts
```
