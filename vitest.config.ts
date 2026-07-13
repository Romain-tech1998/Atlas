import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    // Sprint-023: Vitest's default `threads` pool runs test files inside
    // Node `worker_threads` — `pg`'s socket-based connection handling was
    // unreliable there against `prisma dev`'s PGlite-backed server. `forks`
    // runs each test file in its own real child process, matching how every
    // other Prisma-using script in this project (tsx scripts, `next dev`)
    // already runs. Kept even after Sprint-024's move to a dedicated real
    // Postgres instance, since it's still the more standard choice for a
    // Prisma-based suite and there's no reason to switch back.
    pool: "forks",
    // Sprint-024: boots the dedicated test Postgres instance once for the
    // whole run (scripts/test-postgres.mjs via vitest.global-setup.ts).
    globalSetup: ["./vitest.global-setup.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // Sprint-023 set this to `false`, but its own comment already explained
    // why cross-test parallelism is *safe* (every test creates its own
    // fresh User/Mission fixtures with generated ids, never shared) — the
    // real reason it was disabled was `prisma dev`'s PGlite-backed server
    // not tolerating genuinely concurrent connections at all, not anything
    // about this suite's own tests. Sprint-024 (correction 3) re-enables it
    // now that the suite runs against a real, dedicated Postgres instance;
    // confirmed stable across repeated runs (see Sprint-024 review).
    fileParallelism: true,
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Sprint-023: `evidenceService.ts` transitively imports
      // `google-calendar-provider.ts` (guarded by `import "server-only"`,
      // Next.js's own marker package), even though these tests never
      // exercise that Calendar path. `server-only`'s package.json only
      // resolves to its no-op build under the `react-server` export
      // condition Next.js's bundler sets — Vitest doesn't, so it would
      // otherwise always throw here regardless of which code path a test
      // actually runs. This aliases straight to that same no-op module
      // (test config only — no production file is touched).
      "server-only": path.resolve(__dirname, "./node_modules/server-only/empty.js"),
    },
  },
});
