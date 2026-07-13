import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { VerdictStatusId } from "@/domain/decision";
import type { LocalizedText } from "@/i18n/message";
import { decodePersistedText, encodePersistedText } from "@/i18n/persisted-text";

export interface VerdictRow {
  id: string;
  decisionId: string;
  status: VerdictStatusId;
  recommendation: LocalizedText | null;
  reasoning: LocalizedText | null;
  evidenceCoverage: number | null;
  /** Sprint-006: the Evidence ids `find_lowest_value` compared, or null
   * while INSUFFICIENT_EVIDENCE. See `domain/decision.ts`'s VerdictSummary. */
  comparedEvidenceIds: string[] | null;
  /** Sprint-030: the `compare_options` Skill's per-option scores, or null
   * whenever this Verdict came from `find_lowest_value` instead (including
   * every Verdict that predates Sprint-030). */
  ranking: Array<{ optionLabel: string; score: number }> | null;
}

function toComparedEvidenceIds(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : null;
}

/** Mirrors `toComparedEvidenceIds`'s "drop anything malformed rather than
 * throwing" discipline — each entry must have a string `optionLabel` and a
 * finite `score`, or it's excluded rather than corrupting the whole array. */
function toRanking(value: unknown): Array<{ optionLabel: string; score: number }> | null {
  if (!Array.isArray(value)) return null;
  return value.filter(
    (entry): entry is { optionLabel: string; score: number } =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as Record<string, unknown>).optionLabel === "string" &&
      Number.isFinite((entry as Record<string, unknown>).score),
  );
}

function toVerdictRow(row: {
  id: string;
  decisionId: string;
  status: string;
  recommendation: string | null;
  reasoning: string | null;
  evidenceCoverage: number | null;
  comparedEvidenceIds: unknown;
  ranking: unknown;
}): VerdictRow {
  return {
    id: row.id,
    decisionId: row.decisionId,
    status: row.status as VerdictStatusId,
    recommendation: decodePersistedText(row.recommendation),
    reasoning: decodePersistedText(row.reasoning),
    evidenceCoverage: row.evidenceCoverage,
    comparedEvidenceIds: toComparedEvidenceIds(row.comparedEvidenceIds),
    ranking: toRanking(row.ranking),
  };
}

async function createVerdict(userId: string, decisionId: string): Promise<VerdictRow> {
  const row = await prisma.verdict.create({ data: { userId, decisionId } });
  return toVerdictRow(row);
}

/** The Decision's Verdict (at most one — `decisionId` is unique),
 * ownership-checked via userId. */
async function getVerdictForDecision(userId: string, decisionId: string): Promise<VerdictRow | null> {
  const row = await prisma.verdict.findFirst({ where: { userId, decisionId } });
  return row ? toVerdictRow(row) : null;
}

/** RFC-0001 §4 "Mission Journey" (Sprint-019): batched across every Decision
 * in one Mission, so the Mission detail page can populate each
 * `DecisionSummary.recommendation` in exactly one query — same shape as
 * `axisRequestRepository.getRequestsForDecisions`/`decisionRepository.
 * getAllDecisionsForMissions`. `Verdict.userId` is a direct column, no join
 * needed. Read-only: never called from `listMissionSummaries`'s path, which
 * has no reason to pay for a Verdict fetch across every Mission's every
 * historical Decision (see `missionService`'s loading-strategy split). */
async function getVerdictsForDecisions(userId: string, decisionIds: string[]): Promise<Map<string, VerdictRow>> {
  if (decisionIds.length === 0) return new Map();
  const rows = await prisma.verdict.findMany({ where: { userId, decisionId: { in: decisionIds } } });
  return new Map(rows.map((row) => [row.decisionId, toVerdictRow(row)]));
}

async function setEvidenceCoverage(verdictId: string, evidenceCoverage: number | null): Promise<void> {
  await prisma.verdict.update({ where: { id: verdictId }, data: { evidenceCoverage } });
}

export interface VerdictResult {
  status: VerdictStatusId;
  recommendation: LocalizedText | null;
  reasoning: LocalizedText | null;
  comparedEvidenceIds: string[] | null;
  /** Required (not optional): every call site must say explicitly what it
   * means for this Verdict, same reasoning `comparedEvidenceIds` follows. */
  ranking: Array<{ optionLabel: string; score: number }> | null;
}

/**
 * Persists the `find_lowest_value` Skill's result (Sprint-006) — the only
 * place `VerdictStatus` ever moves to `PRODUCED`. Never touches
 * `evidenceCoverage`: that field's meaning and formula (Sprint-004) are
 * unchanged by this sprint.
 */
async function setVerdictResult(verdictId: string, result: VerdictResult): Promise<void> {
  await prisma.verdict.update({
    where: { id: verdictId },
    data: {
      status: result.status,
      recommendation: result.recommendation ? encodePersistedText(result.recommendation) : null,
      reasoning: result.reasoning ? encodePersistedText(result.reasoning) : null,
      // A nullable Json column needs the explicit DbNull sentinel to set
      // SQL NULL — passing a bare `null` here is a JSON *value* of null,
      // not "no value" (Prisma's Json? convention).
      comparedEvidenceIds: result.comparedEvidenceIds ?? Prisma.DbNull,
      ranking: result.ranking ?? Prisma.DbNull,
    },
  });
}

export const verdictRepository = {
  createVerdict,
  getVerdictForDecision,
  getVerdictsForDecisions,
  setEvidenceCoverage,
  setVerdictResult,
};
