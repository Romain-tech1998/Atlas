// Sprint-024: runs once before the whole suite (Vitest's `globalSetup`) —
// boots a fresh, dedicated Postgres instance (scripts/test-postgres.mjs) and
// applies the current schema to it. The returned teardown stops that
// instance, leaving nothing behind between runs.
//
// Sprint-035 (RFC-0003 §8h addendum): the instance moved from
// `embedded-postgres` (a host data directory, wiped via `rm(DATA_DIR)`) to
// a Docker container with no persistent volume — `start()` already removes
// any stale container from a previous crashed run before booting a fresh
// one, and the container's entire writable layer disappears the moment
// `stopTestPostgres()` removes it, so there's no separate host-path wipe
// step left to do here.
import { createTestPostgres, ensureSchema, stopTestPostgres } from "./scripts/test-postgres.mjs";

export default async function setup() {
  const pg = createTestPostgres();
  await pg.initialise();
  await pg.start();
  await ensureSchema(pg);

  return async () => {
    await stopTestPostgres();
  };
}
