// Sprint-024 (RFC-0001 §4 "Reliable Test Infrastructure"): a genuinely
// dedicated Postgres instance for the test suite, replacing Sprint-023's
// same-physical-store-as-DATABASE_URL fallback. This is a real Postgres
// binary (via `embedded-postgres`, which bundles the actual server
// executable per platform — not a WASM/embedded-in-process engine), run as
// its own OS process on its own port, entirely separate from `prisma dev`'s
// server. `prisma dev`'s local database turned out to be PGlite (an
// embedded, effectively single-connection WASM Postgres) under the hood —
// the root cause of the connection/protocol fragility seen against it across
// Sprints 018/020/021/023 — so this sprint moves off it rather than
// continuing to work around it.
//
// Shared between `vitest.global-setup.ts` (automatic, full lifecycle: wipe
// -> initialise -> start -> push schema -> [tests run] -> stop -> wipe) and
// `scripts/push-test-db.mjs` (a manual, one-shot "make sure the schema is
// current" convenience script, for poking at the test database directly
// without running the whole suite).
import "dotenv/config";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import EmbeddedPostgres from "embedded-postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = path.resolve(__dirname, "..", ".test-postgres-data");

/** Parses connection details out of TEST_DATABASE_URL — the single source
 * of truth for how to reach the test database, same as DATABASE_URL is for
 * the real one. No separate port/user/password env vars: one URL, one
 * place to look. */
export function getTestPostgresConfig() {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) {
    throw new Error("TEST_DATABASE_URL must be set (see .env.example).");
  }
  const url = new URL(raw);
  const database = url.pathname.replace(/^\//, "");
  if (!database) {
    throw new Error("TEST_DATABASE_URL must include a database name.");
  }
  return {
    host: url.hostname,
    port: Number(url.port),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
  };
}

/** Constructs (but does not start) the EmbeddedPostgres instance for the
 * test cluster — `databaseDir` is fixed (`DATA_DIR`), everything else comes
 * from TEST_DATABASE_URL. `persistent: true` because reset semantics are
 * handled explicitly by the caller (wiping `DATA_DIR` before init), not by
 * `stop()`'s own delete-on-shutdown behavior — that keeps "reset before the
 * suite runs" an explicit, visible step rather than an implicit side effect
 * of stopping. */
export function createTestPostgres() {
  const { port, user, password } = getTestPostgresConfig();
  return new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    port,
    user,
    password,
    authMethod: "password",
    persistent: true,
  });
}

/** Creates the target database (idempotent — Postgres itself errors on a
 * duplicate CREATE DATABASE, so this checks first) and applies the current
 * schema via the project's existing `prisma db push` mechanism — the same
 * schema-application workflow used against the real database, just pointed
 * at this dedicated instance. */
export async function ensureSchema(pg) {
  const { database } = getTestPostgresConfig();
  const client = pg.getPgClient("postgres");
  await client.connect();
  try {
    const { rows } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
    if (rows.length === 0) {
      await pg.createDatabase(database);
    }
  } finally {
    await client.end();
  }

  execSync("npx prisma db push", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
  });
}

/** Resolves the `pg_ctl` binary bundled by the platform-specific
 * `@embedded-postgres/*` package `embedded-postgres` itself depends on —
 * mirrors that package's own (internal, unexported) platform switch. */
async function resolvePgCtl() {
  const key = `${os.platform()}-${os.arch()}`;
  const packages = {
    "darwin-arm64": "@embedded-postgres/darwin-arm64",
    "darwin-x64": "@embedded-postgres/darwin-x64",
    "linux-arm64": "@embedded-postgres/linux-arm64",
    "linux-arm": "@embedded-postgres/linux-arm",
    "linux-ia32": "@embedded-postgres/linux-ia32",
    "linux-ppc64": "@embedded-postgres/linux-ppc64",
    "linux-x64": "@embedded-postgres/linux-x64",
    "win32-x64": "@embedded-postgres/windows-x64",
  };
  const packageName = packages[key];
  if (!packageName) throw new Error(`Unsupported platform/arch for embedded Postgres: ${key}`);
  const { pg_ctl } = await import(packageName);
  return pg_ctl;
}

/**
 * Stops the test Postgres cluster via `pg_ctl stop -m fast -w` directly,
 * rather than `EmbeddedPostgres#stop()`. On Windows, that method force-kills
 * the process with `taskkill /f` — which doesn't give Postgres a chance to
 * release its shared-memory segment cleanly, and was observed leaving a
 * zombie state that made the *next* run's fresh `initdb` fail outright
 * ("pre-existing shared memory block is still in use"). `pg_ctl stop -m
 * fast` is Postgres's own documented graceful-shutdown command — `-w` makes
 * it block until shutdown is actually confirmed complete, so this function
 * doesn't return until it's safe for the next run to reuse the same port
 * and data directory.
 */
export async function stopTestPostgres() {
  const pgCtl = await resolvePgCtl();
  execSync(`"${pgCtl}" stop -D "${DATA_DIR}" -m fast -w`, { stdio: "inherit" });
}
