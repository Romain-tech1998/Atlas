// Sprint-024: manual convenience script — applies the current
// prisma/schema.prisma to the dedicated test Postgres instance, exactly the
// same schema-application workflow the project already uses against the
// real database (`prisma db push`), just pointed at TEST_DATABASE_URL. Boots
// the instance, pushes the schema, then stops it again — this is a one-shot
// "make sure the test schema is current" utility, not something `npm test`
// itself depends on. `npm test` handles the whole boot/push/teardown
// lifecycle automatically, every run, via Vitest's `globalSetup`
// (vitest.global-setup.ts) — this script exists only for a developer who
// wants to confirm the schema applies cleanly, or inspect the resulting
// (empty) schema with a separate tool, without running the full suite.
import { createTestPostgres, ensureSchema, stopTestPostgres } from "./test-postgres.mjs";

const pg = createTestPostgres();

await pg.initialise();
await pg.start();
await ensureSchema(pg);
await stopTestPostgres();

console.log("Test database schema is up to date.");
