import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { evidenceService } from "@/services/evidenceService";

/** Sprint-023 (correction 3): every test creates its own fresh `User` with a
 * generated, never-reused email/id — no shared or hardcoded fixtures, so
 * tests can run in any order or in parallel without colliding. `Mission`/
 * `Decision`/`Evidence`/`Verdict`/`AxisRequest`/`LearningSignal` all cascade
 * on `User` deletion (`prisma/schema.prisma`), so deleting the user is
 * sufficient cleanup for everything a test created under it. */
export async function createTestUser() {
  return prisma.user.create({
    data: { email: `test-${randomUUID()}@atlas-test.local`, passwordHash: "test" },
  });
}

export async function deleteTestUser(userId: string): Promise<void> {
  await prisma.user.delete({ where: { id: userId } }).catch(() => {
    // Already gone (e.g. a test that deliberately deletes it) — fine.
  });
}

/** Two comparable Evidence items (same measure/currency, RFC-0001 §4
 * "Measure") is exactly what `find_lowest_value` (Sprint-006/007) needs to
 * move a Verdict to `PRODUCED` — see `src/skills/find-lowest-value.ts`'s
 * `compatibilityKey`/2+-per-group rule. Goes through the real
 * `evidenceService.addEvidence` (which itself runs the real Skill), never a
 * shortcut into `verdictRepository` directly — this is how a test gets a
 * deterministic winner, not a mock. */
export async function produceVerdict(userId: string, decisionId: string): Promise<void> {
  await evidenceService.addEvidence(userId, decisionId, {
    claim: "Store A price",
    source: "user",
    value: 100,
    currency: "CAD",
    measure: "price",
  });
  await evidenceService.addEvidence(userId, decisionId, {
    claim: "Store B price",
    source: "user",
    value: 80,
    currency: "CAD",
    measure: "price",
  });
}
