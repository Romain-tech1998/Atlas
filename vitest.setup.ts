// Swaps the connection target to TEST_DATABASE_URL *before* any test file's
// own imports pull in `@/lib/prisma` (whose module-level
// `createPrismaClient()` call reads `DATABASE_URL` once, at import time) —
// this is what lets every service/repository under test run completely
// unmodified against test data, per Sprint-023's "real persistence, not
// mocks" requirement. Vitest's `setupFiles` are guaranteed to finish running
// before a test file's own module graph is evaluated, so this ordering is
// safe, not incidental. This mechanism is unchanged since Sprint-023
// (correction 2) — only what TEST_DATABASE_URL points at has changed.
//
// As of Sprint-024, TEST_DATABASE_URL addresses a genuinely dedicated
// Postgres instance (a real server, booted and torn down once per run by
// `vitest.global-setup.ts` — via Docker as of Sprint-035, RFC-0003 §8h
// addendum) — not the same physical store as DATABASE_URL. Isolation
// between individual tests still
// comes from `src/test/helpers.ts`'s per-test, uniquely-generated `User`
// fixtures (that solves a different problem than database-level isolation —
// see the Sprint-024 review, correction 1).
import "dotenv/config";

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must be set (see .env.example).");
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
