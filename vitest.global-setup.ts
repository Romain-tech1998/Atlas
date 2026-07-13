// Sprint-024: runs once before the whole suite (Vitest's `globalSetup`) —
// wipes any leftover data from a previous run that crashed mid-suite before
// its own cleanup ran (correction 4's "additive to, not a replacement for,
// per-test cleanup"), then boots a fresh, dedicated Postgres instance
// (scripts/test-postgres.mjs) and applies the current schema to it. The
// returned teardown stops that instance and wipes its data directory again,
// leaving nothing behind between runs.
import { rm } from "node:fs/promises";
import { createTestPostgres, ensureSchema, stopTestPostgres, DATA_DIR } from "./scripts/test-postgres.mjs";

export default async function setup() {
  await rm(DATA_DIR, { recursive: true, force: true });

  const pg = createTestPostgres();
  await pg.initialise();
  await pg.start();
  await ensureSchema(pg);

  return async () => {
    // See stopTestPostgres's own docs: uses `pg_ctl stop -m fast -w`
    // directly rather than `pg.stop()`, which on Windows force-kills the
    // process and was observed leaving shared memory in a state that broke
    // the *next* run's `initdb`.
    await stopTestPostgres();
    await rm(DATA_DIR, { recursive: true, force: true });
  };
}
