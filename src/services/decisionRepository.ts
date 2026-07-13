import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { DecisionStatusId, DecisionResolutionOutcomeId } from "@/domain/decision";
import type { LocalizedText } from "@/i18n/message";
import { decodePersistedText, encodePersistedText } from "@/i18n/persisted-text";

type TransactionClient = Prisma.TransactionClient | PrismaClient;

/** RFC-0001 §4 "Sequential Multi-Decision Missions" (Sprint-018): a
 * Decision counts as "open" (can receive updates, blocks a new Decision
 * from starting) in every status except these two terminal ones. */
const CLOSED_DECISION_STATUSES: DecisionStatusId[] = ["RESOLVED", "ARCHIVED"];

/** Thrown by `createNextDecision` when its own re-check (inside the
 * Serializable transaction) finds an open Decision already exists — the
 * ordinary "the world changed since the caller last looked" case, distinct
 * from a Postgres serialization failure (`P2034`) but handled identically
 * by `decisionService.startNextDecision` (both mean "someone else already
 * has this covered, try again"). */
export class OpenDecisionExistsError extends Error {
  constructor() {
    super("An open Decision already exists for this Mission");
  }
}

export interface DecisionRow {
  id: string;
  missionId: string;
  title: LocalizedText | null;
  status: DecisionStatusId;
  /** Sprint-017 (RFC-0001 §4 "Verdict Acceptance") — null until `RESOLVED`
   * is reached via an explicit accept/decline action; stays null forever
   * for a Decision resolved through any other path (e.g. the Mission being
   * marked complete/abandoned, which predates this sprint). */
  resolutionOutcome: DecisionResolutionOutcomeId | null;
  /** Only ever non-null alongside `resolutionOutcome: "DECLINED"`. */
  resolutionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDecisionRow(row: {
  id: string;
  missionId: string;
  title: string | null;
  status: string;
  resolutionOutcome: string | null;
  resolutionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}): DecisionRow {
  return {
    ...row,
    title: decodePersistedText(row.title),
    status: row.status as DecisionStatusId,
    resolutionOutcome: row.resolutionOutcome as DecisionResolutionOutcomeId | null,
  };
}

async function createDecision(userId: string, missionId: string): Promise<DecisionRow> {
  const row = await prisma.decision.create({ data: { userId, missionId } });
  return toDecisionRow(row);
}

async function setDecisionTitle(decisionId: string, title: LocalizedText): Promise<void> {
  await prisma.decision.update({
    where: { id: decisionId },
    data: { title: encodePersistedText(title) },
  });
}

async function setDecisionStatus(
  decisionId: string,
  status: DecisionStatusId,
  client: TransactionClient = prisma,
): Promise<void> {
  await client.decision.update({ where: { id: decisionId }, data: { status } });
}

/** Sprint-020 (RFC-0001 §4 "Mission Completion Semantics", correction 5): the
 * conditional archive used only by `missionService.setMissionStatus`. Unlike
 * `setDecisionStatus` above (a blind update, kept unchanged for its existing
 * callers), this guards against a Decision that was resolved via the normal
 * Verdict-acceptance flow in the interval between the Mission's active-
 * Decision lookup and this transaction committing (Case G) — archiving it
 * anyway would silently overwrite a real user decision. Matching zero rows
 * means exactly that race happened; the caller does nothing further, since
 * the Decision is already correctly `RESOLVED`. */
async function archiveIfOpen(decisionId: string, client: TransactionClient = prisma): Promise<boolean> {
  const result = await client.decision.updateMany({
    where: { id: decisionId, status: { notIn: CLOSED_DECISION_STATUSES } },
    data: { status: "ARCHIVED" },
  });
  return result.count === 1;
}

/** Sprint-017 (RFC-0001 §4 "Verdict Acceptance"): the only path that ever
 * sets `resolutionOutcome`/`resolutionNote` — always alongside moving
 * `status` to `RESOLVED` in the same write, since these fields only mean
 * anything once the Decision is actually resolved. `note` is only ever
 * supplied for `"DECLINED"` — `decisionService.resolveDecision` enforces
 * that business rule before calling this; this function just persists
 * whatever it's given. */
async function resolveDecision(
  decisionId: string,
  resolution: { outcome: DecisionResolutionOutcomeId; note?: string },
): Promise<void> {
  await prisma.decision.update({
    where: { id: decisionId },
    data: {
      status: "RESOLVED",
      resolutionOutcome: resolution.outcome,
      resolutionNote: resolution.note ?? null,
    },
  });
}

/** Ownership-checked single Decision lookup — returns null if it doesn't
 * exist or doesn't belong to this user. Used to authorize writes (e.g.
 * attaching Evidence) that take a decisionId directly from a client. */
async function getDecisionById(userId: string, decisionId: string): Promise<DecisionRow | null> {
  const row = await prisma.decision.findFirst({ where: { id: decisionId, userId } });
  return row ? toDecisionRow(row) : null;
}

/** RFC-0001 §4 "Sequential Multi-Decision Missions" (Sprint-018): the
 * Mission's currently open Decision, or null between a resolution and the
 * user's next update. Never a `RESOLVED`/`ARCHIVED` row — under the
 * sequential invariant this sprint enforces (a new Decision is only ever
 * created when none is open), at most one Decision can ever match this
 * query at a time, so `take: 1` with a deterministic tie-break (`id desc`,
 * for the same-millisecond edge case) is exact, not a heuristic. */
async function getActiveDecisionForMission(userId: string, missionId: string): Promise<DecisionRow | null> {
  const row = await prisma.decision.findFirst({
    where: { userId, missionId, status: { notIn: CLOSED_DECISION_STATUSES } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return row ? toDecisionRow(row) : null;
}

/** Same as getActiveDecisionForMission, batched across several missions at
 * once to avoid an N+1 query when listing missions. A mission with no open
 * Decision is simply absent from the returned Map. */
async function getActiveDecisionsForMissions(
  userId: string,
  missionIds: string[],
): Promise<Map<string, DecisionRow>> {
  if (missionIds.length === 0) return new Map();

  const rows = await prisma.decision.findMany({
    where: { userId, missionId: { in: missionIds }, status: { notIn: CLOSED_DECISION_STATUSES } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  const byMission = new Map<string, DecisionRow>();
  for (const row of rows) {
    // Descending order means the first row seen per mission is its most
    // recent open Decision — and by the sequential invariant there's never
    // more than one anyway.
    if (!byMission.has(row.missionId)) {
      byMission.set(row.missionId, toDecisionRow(row));
    }
  }
  return byMission;
}

/** Every Decision that has ever belonged to this Mission, oldest first —
 * no status filter, unlike `getActiveDecisionForMission`. Sprint-018: the
 * source of truth for (a) the Mission-scoped Timeline (concatenate each
 * Decision's own timeline in this order) and (b) Current Focus (the last
 * element — the most recently created Decision, open or resolved) and (c)
 * whether a Mission has ever had a Decision at all (empty array — the
 * legacy pre-Sprint-003 case `ensureDecisionForMission` still handles). */
async function getAllDecisionsForMission(userId: string, missionId: string): Promise<DecisionRow[]> {
  const rows = await prisma.decision.findMany({
    where: { userId, missionId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toDecisionRow);
}

/** Same as getAllDecisionsForMission, batched across several missions. */
async function getAllDecisionsForMissions(
  userId: string,
  missionIds: string[],
): Promise<Map<string, DecisionRow[]>> {
  if (missionIds.length === 0) return new Map();

  const rows = await prisma.decision.findMany({
    where: { userId, missionId: { in: missionIds } },
    orderBy: { createdAt: "asc" },
  });

  const byMission = new Map<string, DecisionRow[]>();
  for (const row of rows) {
    const decision = toDecisionRow(row);
    const existing = byMission.get(row.missionId);
    if (existing) {
      existing.push(decision);
    } else {
      byMission.set(row.missionId, [decision]);
    }
  }
  return byMission;
}

/**
 * RFC-0001 §4 "Sequential Multi-Decision Missions" (Sprint-018, correction
 * 3): the check-then-create step for starting the Mission's next Decision,
 * done as one `Serializable`-isolation transaction so Postgres itself
 * detects a genuine concurrent conflict between two overlapping calls
 * rather than trusting an ordinary `READ COMMITTED` transaction to prevent
 * it — which it would not: two concurrent `READ COMMITTED` transactions can
 * both read "no open Decision" before either commits.
 *
 * The failure mode observed running this live under real concurrent load
 * was **not** always Prisma's documented `P2034` serialization-failure
 * code — under this environment's connection pooling, a losing transaction
 * sometimes surfaces as a lower-level driver/connection error instead
 * (e.g. a `DriverAdapterError` before the transaction body even runs). This
 * function does not pattern-match a specific error code; on ANY failure
 * during the attempt, it re-checks whether an open Decision demonstrably
 * exists now: if so, the failure — whatever shape it took — really was a
 * lost race, so it's reported as `OpenDecisionExistsError`; if not, the
 * failure was something else entirely and is rethrown unmasked. This is
 * the honest guarantee: Postgres/the driver will not let both of two
 * conflicting attempts *silently* succeed, but the specific error shape
 * that surfaces for the loser is not itself a stable contract.
 */
async function createNextDecision(userId: string, missionId: string): Promise<DecisionRow> {
  try {
    const row = await prisma.$transaction(
      async (tx) => {
        const existing = await tx.decision.findFirst({
          where: { userId, missionId, status: { notIn: CLOSED_DECISION_STATUSES } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
        if (existing) throw new OpenDecisionExistsError();

        return tx.decision.create({ data: { userId, missionId } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return toDecisionRow(row);
  } catch (error) {
    if (error instanceof OpenDecisionExistsError) throw error;
    const nowOpen = await getActiveDecisionForMission(userId, missionId);
    if (nowOpen) throw new OpenDecisionExistsError();
    throw error;
  }
}

/**
 * RFC-0001 §4 "Sequential Multi-Decision Missions" (Sprint-018): the
 * check-then-create step for the legacy backfill path
 * (`decisionService.ensureDecisionForMission`), protected the same way as
 * `createNextDecision` and for a concretely observed reason, not a
 * hypothetical one — the Mission page calls `missionService.
 * getMissionSummary` and `listMissionSummaries` concurrently via
 * `Promise.all`, and both independently detect "zero Decisions ever" for
 * the same never-before-opened legacy Mission on its very first load. An
 * ordinary check-then-create here previously created two Decision rows for
 * one Mission on a single page render — this closes that.
 *
 * Unlike `createNextDecision`, finding an existing Decision here is never
 * an error: it means another concurrent call already did (or is doing)
 * this exact repair, so this one simply returns that Decision with
 * `created: false` rather than repeating the backfill. Any failure during
 * the attempt (a genuine Postgres serialization failure, or — observed in
 * practice under this environment's connection pooling — a lower-level
 * driver/connection error) is handled the same non-error way: re-read
 * whatever Decision exists now and use it. Only if no Decision exists even
 * after the failure is the original error rethrown unmasked — see
 * `createNextDecision`'s note on why this doesn't pattern-match a specific
 * error code.
 */
async function ensureFirstDecision(userId: string, missionId: string): Promise<{ decision: DecisionRow; created: boolean }> {
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const existing = await tx.decision.findFirst({
          where: { userId, missionId },
          orderBy: { createdAt: "asc" },
        });
        if (existing) return { row: existing, created: false as const };

        const created = await tx.decision.create({ data: { userId, missionId } });
        return { row: created, created: true as const };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return { decision: toDecisionRow(result.row), created: result.created };
  } catch (error) {
    const existing = await prisma.decision.findFirst({ where: { userId, missionId }, orderBy: { createdAt: "asc" } });
    if (existing) return { decision: toDecisionRow(existing), created: false };
    throw error;
  }
}

export const decisionRepository = {
  createDecision,
  setDecisionTitle,
  setDecisionStatus,
  archiveIfOpen,
  resolveDecision,
  getDecisionById,
  getActiveDecisionForMission,
  getActiveDecisionsForMissions,
  getAllDecisionsForMission,
  getAllDecisionsForMissions,
  createNextDecision,
  ensureFirstDecision,
};
