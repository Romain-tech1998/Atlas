// Sprint-024 (RFC-0001 §4 "Reliable Test Infrastructure"): a genuinely
// dedicated Postgres instance for the test suite, replacing Sprint-023's
// same-physical-store-as-DATABASE_URL fallback.
//
// Sprint-035 (RFC-0003 §8h addendum): the `embedded-postgres` npm package
// this originally used wraps a vanilla per-platform Postgres binary with no
// `pgvector` extension and no mechanism to add one (confirmed directly, not
// assumed) — the same gap that also forced the dev database off `prisma
// dev`. Both moved to Docker, running the official `pgvector/pgvector`
// image. The exported functions below (createTestPostgres/ensureSchema/
// stopTestPostgres) keep their exact names and call sites; only the
// lifecycle underneath changed, from the `EmbeddedPostgres` Node API
// (initialise/start/stop) to the equivalent Docker CLI calls (`docker run`/
// wait-for-`pg_isready`/`docker rm -f`). No named volume is used for the
// test container — an ephemeral container's writable layer disappears the
// moment it's removed, which is exactly the "wiped clean before and after"
// guarantee the old DATA_DIR wipe gave, for free.
//
// Shared between `vitest.global-setup.ts` (automatic, full lifecycle: wipe
// -> start -> push schema -> [tests run] -> stop) and
// `scripts/push-test-db.mjs` (a manual, one-shot "make sure the schema is
// current" convenience script, for poking at the test database directly
// without running the whole suite).
import "dotenv/config";
import { execSync } from "node:child_process";
import pg from "pg";

const { Client } = pg;

const CONTAINER_NAME = "atlas-test-postgres";
const IMAGE = "pgvector/pgvector:pg17";

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

function tryRun(command) {
  try {
    execSync(command, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** `pg_isready` alone isn't sufficient — it can report "accepting
 * connections" for an instant right as the server transitions from
 * startup to ready, and a real client connecting in that window gets a
 * `FATAL: the database system is starting up` (observed directly, not a
 * hypothetical). So this only declares readiness once an actual client can
 * connect and run a trivial query against the "postgres" maintenance
 * database. */
async function waitUntilReady(config, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (tryRun(`docker exec ${CONTAINER_NAME} pg_isready -U ${config.user}`)) {
      const client = new Client({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: "postgres",
      });
      try {
        await client.connect();
        await client.query("SELECT 1");
        return;
      } catch {
        // Not actually ready yet — fall through to retry.
      } finally {
        await client.end().catch(() => {});
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Test Postgres container did not become ready within ${timeoutMs}ms.`);
}

/** Constructs (but does not start) the test Postgres handle. `initialise()`
 * is a no-op — the Docker image bootstraps its own data directory on first
 * boot inside the container, there's no separate cluster-files step the
 * way `EmbeddedPostgres` needed — kept only so `push-test-db.mjs`'s
 * unconditional call to it doesn't need to change. */
export function createTestPostgres() {
  const config = getTestPostgresConfig();
  return {
    async initialise() {},
    /** Removes any stale container from a previous crashed run (the same
     * "wipe before boot" guarantee this project has held since Sprint-024),
     * then starts a fresh one and waits for it to accept connections. */
    async start() {
      tryRun(`docker rm -f ${CONTAINER_NAME}`);
      execSync(
        `docker run -d --name ${CONTAINER_NAME} ` +
          `-e POSTGRES_USER=${config.user} -e POSTGRES_PASSWORD=${config.password} ` +
          `-p ${config.port}:5432 ${IMAGE}`,
        { stdio: "inherit" },
      );
      await waitUntilReady(config);
    },
    getPgClient(database) {
      return new Client({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database,
      });
    },
  };
}

/** Creates the target database (idempotent — checks first, same as before),
 * explicitly creates the `vector` extension inside it (extensions are
 * per-database in Postgres, so this can't happen against the "postgres"
 * maintenance database used just above — and is done explicitly here
 * rather than assumed as a side effect of Prisma's own `extensions =
 * [vector]` datasource config, confirmed this needs to be explicit per
 * RFC-0003 §8h's own "verify, don't assume" discipline), then applies the
 * current schema via the project's existing `prisma db push` mechanism. */
export async function ensureSchema(pg) {
  const { database } = getTestPostgresConfig();

  const maintenanceClient = pg.getPgClient("postgres");
  await maintenanceClient.connect();
  try {
    const { rows } = await maintenanceClient.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
    if (rows.length === 0) {
      await maintenanceClient.query(`CREATE DATABASE "${database}"`);
    }
  } finally {
    await maintenanceClient.end();
  }

  const dbClient = pg.getPgClient(database);
  await dbClient.connect();
  try {
    await dbClient.query("CREATE EXTENSION IF NOT EXISTS vector;");
  } finally {
    await dbClient.end();
  }

  execSync("npx prisma db push", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
  });
}

/** Force-removes the test container. Unlike the old `pg_ctl stop -m fast
 * -w` approach (needed because `EmbeddedPostgres#stop()`'s Windows
 * force-kill left shared memory in a bad state for the *next* run's
 * `initdb`), `docker rm -f` has no equivalent problem to work around —
 * removing the container discards its entire writable layer, so the next
 * `start()` always begins from a clean image, every time. */
export async function stopTestPostgres() {
  tryRun(`docker rm -f ${CONTAINER_NAME}`);
}
