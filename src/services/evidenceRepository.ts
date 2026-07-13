import { prisma } from "@/lib/prisma";

export interface EvidenceRow {
  id: string;
  decisionId: string;
  claim: string;
  source: string;
  observedAt: Date;
  createdAt: Date;
  metadata: unknown;
}

/** `metadata` (Sprint-008): the structured-input path's `value`/`currency`/
 * `measure`, or undefined for a plain free-text Evidence — same optional
 * column Sprint-004 always had, just finally written to from a second
 * caller. */
async function createEvidence(
  userId: string,
  decisionId: string,
  claim: string,
  source: string,
  observedAt: Date,
  metadata?: Record<string, string | number>,
): Promise<EvidenceRow> {
  return prisma.evidence.create({ data: { userId, decisionId, claim, source, observedAt, metadata } });
}

/** All Evidence recorded against a Decision, oldest first, ownership-checked via userId. */
async function getEvidenceForDecision(userId: string, decisionId: string): Promise<EvidenceRow[]> {
  return prisma.evidence.findMany({
    where: { userId, decisionId },
    orderBy: { createdAt: "asc" },
  });
}

export const evidenceRepository = { createEvidence, getEvidenceForDecision };
