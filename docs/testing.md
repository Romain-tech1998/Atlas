# Automated tests — architecture and how to add more

Sprint-023 introduced Atlas's first service-level tests (Vitest, targeting
`missionService`/`decisionService`). Sprint-024 moved the database they run
against off `prisma dev`'s local server onto a genuinely dedicated Postgres
instance. This doc covers where tests run, how the database is
prepared/reset, and how to add new ones.

## Where tests run

- **Framework**: [Vitest](https://vitest.dev/), configured in
  `vitest.config.ts`.
- **Test files**: `src/**/*.test.ts` (currently
  `src/services/__tests__/missionService.test.ts` and `decisionService.test.ts`).
- **Scope**: service-layer only — `missionService`/`decisionService` and
  whatever they call for real (`decisionRepository`, `evidenceService`,
  `verdictRepository`, the real Axis pipeline). No mocks of anything inside
  the app; the only thing stubbed out is `server-only` (Next.js's own
  server/client marker package), aliased to a no-op so Vitest doesn't choke
  on a module boundary that only matters to Next.js's own bundler.

## The database

Tests run against a **dedicated Postgres instance**, entirely separate from
`prisma dev` (the local database `npm run dev` uses). This is a real
Postgres server binary — not `prisma dev`'s own database, which turned out
to be [PGlite](https://pglite.dev/) (an embedded, effectively
single-connection, WASM-compiled Postgres) under the hood. That's the root
cause of the connection/protocol errors (`DriverAdapterError`, "Server has
closed the connection") this project hit repeatedly across Sprints
018/020/021/023 whenever two things tried to query it concurrently — no
amount of database-name or schema-level separation on `prisma dev` itself
ever fully fixed that, because the underlying engine doesn't reliably
support genuine concurrent connections at all.

The dedicated instance is provided by the
[`embedded-postgres`](https://www.npmjs.com/package/embedded-postgres) npm
package, which bundles a real, platform-specific Postgres server binary and
runs it as an ordinary child process — no Docker, no manual Postgres
install required. (Docker was preferred per this project's own stated
preference, but wasn't available in this development environment; a real
local Postgres install was the documented fallback, but wasn't available
either, so this embedded-binary approach was used instead — see the
Sprint-024 review for the full reasoning.)

### Bootstrap sequence (automatic, every `npm test` run)

Vitest's `globalSetup` (`vitest.global-setup.ts`) runs once before the whole
suite:

1. Wipe `.test-postgres-data/` (guards against leftovers from a previous run
   that crashed before its own cleanup ran).
2. `initdb` a fresh cluster there, `pg_ctl start` it on the port from
   `TEST_DATABASE_URL`.
3. Create the `atlas_test` database if it doesn't exist.
4. Apply the current `prisma/schema.prisma` via `prisma db push` — the exact
   same schema-application command already used against the real database.

After the whole suite finishes, the returned teardown stops the instance
(`pg_ctl stop -m fast -w` — a real graceful shutdown, not a force-kill; see
`scripts/test-postgres.mjs`'s comments for why that distinction matters on
Windows) and wipes the data directory again. Nothing is left running or on
disk between runs.

`vitest.setup.ts` (a per-file `setupFiles` entry, not `globalSetup`) is what
actually points the app at this instance: it swaps `process.env.DATABASE_URL`
to `TEST_DATABASE_URL` before any test file's own imports pull in
`@/lib/prisma` — that's what lets every service/repository under test run
completely unmodified, pointed at test data instead of real data, with zero
production code changes.

### Manual convenience: `npm run test:db:push`

`npm test` doesn't need this — the bootstrap above happens automatically,
every run. `npm run test:db:push` (`scripts/push-test-db.mjs`) is a
one-shot utility for a developer who wants to confirm the schema applies
cleanly, or point another tool (`psql`, `npx prisma studio`) at the test
database, without running the whole suite. It boots the instance, applies
the schema, and stops it again.

## Two different kinds of isolation — both needed

- **Database-level isolation** (this sprint): a dedicated Postgres instance
  means test runs can never read or write real demo data, and vice versa.
- **Per-test isolation** (Sprint-023, `src/test/helpers.ts`): every test
  creates its own fresh `User` row with a generated id/email
  (`createTestUser`) and deletes it afterward (`deleteTestUser`, which
  cascades to every Mission/Decision/Evidence/Verdict/AxisRequest/
  LearningSignal that test created). This solves a *different* problem than
  database-level isolation: two tests sharing one Mission/User would corrupt
  each other's Decision-count or Timeline assertions even inside the exact
  same dedicated test database. Neither mechanism makes the other
  redundant — keep both.

## Adding a new service test

1. Add a `.test.ts` file under `src/services/__tests__/` (or colocate it
   next to the service, following the existing pattern).
2. In `beforeEach`, call `createTestUser()` from `@/test/helpers` to get a
   fresh, isolated `User`. In `afterEach`, call `deleteTestUser(userId)`.
3. Call the real service functions — never mock `@/lib/prisma` or any
   repository. If your test needs a Verdict to reach `PRODUCED`, use
   `produceVerdict()` from `@/test/helpers` (or add a similarly-real helper)
   rather than writing directly into the `Verdict` table.
4. If your test needs a deterministic Axis pipeline outcome (e.g. a specific
   module routing, or a blocked/unblocked Decision), construct the raw input
   string by reading the actual rules in `src/brain/intent/intentEngine.ts`
   and `src/brain/entity/entityEngine.ts` — don't guess at a phrase that
   *seems* like it should match; a test built on a guess that doesn't
   actually hit the intended code path is worse than no test.
5. Assert on persisted state and returned values only — never on which
   Prisma method was called, how many times, or in what transaction shape.

## Known rough edges

- Vitest occasionally prints `close timed out after 10000ms` /
  `something prevents Vite server from exiting` at the very end of a run.
  This is cosmetic — the Postgres shutdown itself completes cleanly (visible
  in the log immediately above it), test results are already reported
  correctly by that point, and it doesn't block or corrupt the next run.
- No CI wiring yet — `npm test` exists and is reliable locally, but nothing
  runs it automatically on push.
