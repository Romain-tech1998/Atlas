import { prisma } from "@/lib/prisma";
import { missionRepository, type MissionRow } from "@/services/missionRepository";
import { axisRequestRepository } from "@/services/axisRequestRepository";
import { decisionRepository, type DecisionRow } from "@/services/decisionRepository";
import { decisionService } from "@/services/decisionService";
import { verdictRepository, type VerdictRow } from "@/services/verdictRepository";
import { learningRepository } from "@/brain/learning/learningRepository";
import { rawLocalizedText } from "@/i18n/render";
import { localized } from "@/i18n/message";
import type { AxisPipelineResult } from "@/brain/types";
import type { DecisionFocus, DecisionSummary } from "@/domain/decision";
import type { MissionOutcomeEntry, MissionStatusId, MissionSummary } from "@/domain/mission";

class MissionNotFoundError extends Error {
  constructor() {
    super("Mission not found");
  }
}

/** Sprint-020 (RFC-0001 §4 "Mission Completion Semantics"): thrown by
 * `addMissionUpdate` when the Mission is already terminal — enforced by the
 * service layer, never trusted to the UI alone (architecture decision 7). */
class MissionNotActiveError extends Error {
  constructor() {
    super("Mission is not active");
  }
}

/** Sprint-020: thrown by `setMissionStatus` when the atomic conditional
 * transition affects zero rows and the Mission demonstrably still exists —
 * i.e. it was already `COMPLETED`/`ABANDONED` (architecture decision 4:
 * every terminal-to-terminal combination, including the same status twice,
 * is rejected — reactivation is out of scope). */
class MissionAlreadyTerminalError extends Error {
  constructor() {
    super("Mission is already terminal");
  }
}

/** Sprint-020: thrown by `setMissionStatus` for any `status` other than
 * `COMPLETED`/`ABANDONED` — `"ACTIVE"` is no longer a meaningful target
 * (architecture decision 4: only two transitions exist). */
class InvalidMissionTransitionError extends Error {
  constructor() {
    super("Invalid mission status transition");
  }
}

const TERMINAL_STATUSES: readonly MissionStatusId[] = ["COMPLETED", "ABANDONED"];

/** RFC-0001 §4 "Sequential Multi-Decision Missions" (Sprint-018), extended
 * by "Mission Journey" (Sprint-019): turns a Mission row + every one of its
 * Decisions' own summaries (oldest first) into what the Mission page
 * renders. `currentFocus` and `timeline` are independently derived here —
 * never a pass-through of `activeDecision`'s own focus/timeline (see
 * `domain/mission.ts`). `decisionSummaries` is never empty by the time this
 * is called: callers guarantee at least the legacy-backfilled Decision
 * exists first.
 *
 * Sprint-019's two-stage build: `decisionService.buildDecisionSummary` set
 * safe placeholders for `number`/`isActive`/`recommendation` (it has no
 * Mission-level context to compute them honestly). This function is the
 * only place that overwrites all three — position among siblings, which
 * sibling is active, and the batched Verdict lookup all require Mission-
 * level context this function alone has. `verdictsByDecision` is optional:
 * `getMissionSummary` fetches it (Mission detail needs each Decision's
 * `recommendation`); `listMissionSummaries` omits it entirely (the list
 * view never reads `recommendation`, so it has no reason to pay for a
 * Verdict query across every Mission's every historical Decision) — every
 * entry's `recommendation` stays `null` in that path, which is harmless.
 */
function buildMissionSummary(
  mission: MissionRow,
  decisionSummaries: DecisionSummary[],
  activeDecision: DecisionRow | null,
  verdictsByDecision?: Map<string, VerdictRow>,
): MissionSummary {
  const decisions: DecisionSummary[] = decisionSummaries.map((summary, index) => {
    const verdict = verdictsByDecision?.get(summary.id);
    return {
      ...summary,
      number: index + 1,
      isActive: summary.id === activeDecision?.id,
      recommendation: verdict?.status === "PRODUCED" ? verdict.recommendation : null,
    };
  });

  const latestSummary = decisions[decisions.length - 1];

  // Sprint-020 (RFC-0001 §4 "Mission Completion Semantics", scope 6): once
  // the Mission itself is terminal, Current Focus becomes a Mission-level
  // fact, not a pass-through of the latest Decision's own focus — reusing
  // the exact placeholder shape `computeDecisionFocus`'s own RESOLVED/
  // ARCHIVED branches already use (byte-identical function, zero changes;
  // only this call site now overrides its result afterward).
  const isTerminal = mission.status !== "ACTIVE";
  const currentFocus: DecisionFocus = isTerminal
    ? {
        headline: localized(
          mission.status === "COMPLETED" ? "mission.currentFocus.missionCompleted" : "mission.currentFocus.missionAbandoned",
        ),
        detail: null,
        automationLevel: latestSummary.focus.automationLevel,
        confidence: latestSummary.focus.confidence,
        blocked: false,
        missingFields: [],
      }
    : latestSummary.focus;

  // Sprint-020 (correction 1): non-null only when terminal AND an
  // `outcomeAt` was actually recorded — a legacy terminal Mission (no
  // recorded date) renders no entry at all (Case F), never a fabricated one.
  const outcomeEntry: MissionOutcomeEntry | null =
    isTerminal && mission.outcomeAt
      ? {
          kind: "mission-outcome",
          id: `${mission.id}-outcome`,
          outcome: mission.status === "COMPLETED" ? "completed" : "abandoned",
          note: mission.outcomeNote,
          createdAt: mission.outcomeAt.toISOString(),
        }
      : null;

  return {
    id: mission.id,
    goal: mission.goal,
    title: mission.title ?? rawLocalizedText(mission.goal),
    status: mission.status,
    createdAt: mission.createdAt.toISOString(),
    updatedAt: mission.updatedAt.toISOString(),
    outcomeAt: mission.outcomeAt?.toISOString() ?? null,
    outcomeNote: mission.outcomeNote,
    currentFocus,
    updateCount: decisions.reduce((sum, summary) => sum + summary.updateCount, 0),
    lastUpdatedAt: latestSummary.lastUpdatedAt,
    // Concatenation only: each Decision's own timeline is already ordered
    // oldest-to-newest and already ends with its resolution entry
    // (Sprint-017) when resolved, so this produces the correct full stream
    // with no extra sorting or synthetic "Decision started" entries.
    timeline: decisions.flatMap((summary) => summary.timeline),
    activeDecision: activeDecision
      ? { id: activeDecision.id, title: activeDecision.title ?? rawLocalizedText(""), status: activeDecision.status }
      : null,
    decisions,
    outcomeEntry,
  };
}

/** Creates a mission from the user's raw intention, and its single
 * Decision, running the first Axis pipeline pass toward it in one step. */
async function createMission(userId: string, rawInput: string): Promise<{ missionId: string; result: AxisPipelineResult }> {
  const mission = await missionRepository.createMission(userId, rawInput.trim());
  const { result } = await decisionService.createDecisionForMission(userId, mission.id, rawInput);
  await missionRepository.setMissionTitle(mission.id, result.summary);
  return { missionId: mission.id, result };
}

/**
 * RFC-0001 §4 "Sequential Multi-Decision Missions" (Sprint-018): three
 * explicit branches, corresponding exactly to the three states a Mission's
 * Decisions can be in — never inferred, never merged into one helper:
 *
 * A. An open Decision exists — unchanged Sprint-002/003 behavior via
 *    `decisionService.addDecisionUpdate`.
 * B. The Mission has at least one Decision, but none currently open (the
 *    ordinary post-resolution state) — `decisionService.startNextDecision`
 *    starts the next one. This is the only place a new Decision is ever
 *    created from an explicit user update.
 * C. The Mission has zero Decisions ever (pre-Sprint-003 legacy) — the
 *    narrowed `ensureDecisionForMission` backfill, then treated as a normal
 *    update toward the newly-backfilled Decision — never confused with B.
 */
async function addMissionUpdate(userId: string, missionId: string, rawInput: string): Promise<AxisPipelineResult> {
  const mission = await missionRepository.getMission(userId, missionId);
  if (!mission) throw new MissionNotFoundError();
  // Sprint-020 (RFC-0001 §4 "Mission Completion Semantics", architecture
  // decision 7): a terminal Mission cannot accept updates or start a new
  // Decision — checked before any Decision lookup, Atlas Brain call, or
  // Decision/AxisRequest creation of any kind (Case E).
  if (mission.status !== "ACTIVE") throw new MissionNotActiveError();

  const activeDecision = await decisionRepository.getActiveDecisionForMission(userId, missionId);
  if (activeDecision) {
    return decisionService.addDecisionUpdate(userId, missionId, activeDecision, rawInput);
  }

  const allDecisions = await decisionRepository.getAllDecisionsForMission(userId, missionId);
  if (allDecisions.length > 0) {
    const { result } = await decisionService.startNextDecision(userId, missionId, rawInput);
    return result;
  }

  const decision = await decisionService.ensureDecisionForMission(userId, missionId);
  return decisionService.addDecisionUpdate(userId, missionId, decision, rawInput);
}

/**
 * Sprint-020 (RFC-0001 §4 "Mission Completion Semantics"): the only two
 * legal transitions are `ACTIVE -> COMPLETED`/`ABANDONED` (architecture
 * decision 4) — completion and Decision resolution are fully independent
 * (decision 2): at most one Decision mutation ever happens here, an open
 * Decision moving to `ARCHIVED`, never `RESOLVED` (decision 3).
 *
 * Sequence: reject any non-terminal target status; normalize the optional
 * note (trim, empty -> null, no length cap — correction 3); read the
 * Mission's current active Decision id *before* opening the transaction;
 * run the Mission transition and the conditional Decision archive inside
 * one shared transaction (correction 4, reusing `saveAxisResult`'s
 * `tx`-threading shape); resolve 404-vs-409 with one post-transaction read
 * only on failure (decision 6); record the Learning Signal outside the
 * transaction with the widened source resolution (correction 2); return
 * the rebuilt summary.
 *
 * Sprint-021 (RFC-0001 §4 "Terminal Transition Concurrency Hardening"):
 * everything from the transaction attempt through the final summary read is
 * wrapped in one `try/catch`. Sprint-020's own review found that a genuine
 * concurrent request against the same Mission can surface a connection/
 * protocol-level error (`DriverAdapterError`, same signature already
 * documented against Sprint-018's `createNextDecision`/`ensureFirstDecision`)
 * anywhere in that span. The catch block never retries the mutation; it
 * re-verifies, via a fresh read, whether the transition THIS call requested
 * already committed durably (the same "verify honestly rather than trust
 * in-flight state" discipline Sprint-018 established one level down) — but
 * only for genuinely unexpected errors. `MissionAlreadyTerminalError`/
 * `MissionNotFoundError`/`InvalidMissionTransitionError` are this function's
 * own deliberate, already-correct outcomes (e.g. the same status requested
 * twice, sequentially, with no concurrency involved at all) and are always
 * rethrown immediately, unreconciled — reconciling them would incorrectly
 * turn a legitimate repeat-request 409 into a false 200.
 *
 * Sprint-022 (RFC-0001 §4 "Atomic Mission Outcome Learning"): the Learning
 * Signal write moves inside the transaction, alongside the Decision archive
 * — Mission transition, Decision archival, and Learning Signal creation are
 * now one atomic business event (they commit or roll back together), never
 * three separately-fallible steps. Every input the signal write needs
 * (`latestDecisionId`, `latestRequestId`) is resolved *before* the
 * transaction opens, mirroring `activeDecision`'s existing pre-transaction
 * timing exactly — none of these reads can be invalidated by the
 * transaction's own writes (completing a Mission never creates/modifies an
 * `AxisRequest`, and no new Decision can start once the Mission leaves
 * `ACTIVE`). This closes Sprint-021's own disclosed gap: previously, a
 * reconciled-success response could legitimately have no Learning Signal
 * behind it, because the signal was written *after* the transaction, non-
 * transactionally. After this sprint that's no longer possible by
 * construction — Sprint-021's reconciliation catch block needs no changes,
 * because once the Mission's persisted state confirms the transition
 * committed, the signal is guaranteed to have committed in the same unit.
 *
 * Worth stating plainly: this deliberately couples the Learning Signal's
 * success to the Mission transition's — if `saveSignals` itself were to
 * throw for a genuine, unrelated reason, the whole transaction (including
 * the Mission transition and Decision archive) now rolls back with it,
 * where previously a signal-layer failure couldn't have affected Mission
 * completion at all. That's the correct trade-off for "one business event,
 * one commit" — `saveSignals` is a simple `createMany` with no branching
 * logic that could plausibly fail for reasons unrelated to the database
 * itself, but this is a real behavioral change, not a free improvement.
 */
async function setMissionStatus(
  userId: string,
  missionId: string,
  status: MissionStatusId,
  note?: string,
): Promise<MissionSummary> {
  if (!TERMINAL_STATUSES.includes(status)) throw new InvalidMissionTransitionError();
  const terminalStatus = status as "COMPLETED" | "ABANDONED";

  const normalizedNote = note?.trim() || null;

  // Read before opening the transaction — cheap, and safe given the
  // in-transaction archive is itself conditional (correction 5, Case G): if
  // this exact Decision gets resolved via the normal Verdict-acceptance flow
  // in the interval before the transaction commits, the conditional archive
  // below simply matches zero rows and leaves it untouched.
  const activeDecision = await decisionRepository.getActiveDecisionForMission(userId, missionId);

  // Sprint-022 (scope 1): resolve the Learning Signal's inputs before the
  // transaction opens too, same discipline as `activeDecision` above. An
  // open Decision IS the Mission's most-recently-created one (Sprint-018
  // invariant), so no separate lookup is needed in that branch; otherwise
  // (Case A — last Decision already resolved) fall back to the
  // most-recently-created Decision across the whole Mission, exactly as
  // Sprint-020/021's post-transaction code already did, just moved earlier.
  const signalType = status === "COMPLETED" ? "user_feedback_positive" : "user_abandoned_flow";
  let latestDecisionId: string | null = activeDecision?.id ?? null;
  if (!latestDecisionId) {
    const allDecisions = await decisionRepository.getAllDecisionsForMission(userId, missionId);
    latestDecisionId = allDecisions[allDecisions.length - 1]?.id ?? null;
  }
  let latestRequestId: string | null = null;
  if (latestDecisionId) {
    const requests = await axisRequestRepository.getRequestsForDecision(userId, latestDecisionId);
    latestRequestId = requests[requests.length - 1]?.id ?? null;
  }

  try {
    const transitioned = await prisma.$transaction(async (tx) => {
      const didTransition = await missionRepository.transitionToTerminalStatus(
        userId,
        missionId,
        { status: terminalStatus, outcomeAt: new Date(), outcomeNote: normalizedNote },
        tx,
      );
      if (didTransition && activeDecision) {
        await decisionRepository.archiveIfOpen(activeDecision.id, tx);
      }
      // Sprint-022 (scope 2): gated on the exact same `didTransition` the
      // Decision archive above already checks — a losing request never
      // writes a signal, same as before this sprint.
      if (didTransition && latestRequestId && latestDecisionId) {
        await learningRepository.saveSignals(
          userId,
          latestRequestId,
          [
            {
              type: signalType,
              payload: { missionId, decisionId: latestDecisionId, reason: `mission_${status.toLowerCase()}` },
            },
          ],
          tx,
        );
      }
      return didTransition;
    });

    if (!transitioned) {
      // Distinguish 404 (never existed / not this user's) from 409 (exists,
      // but was already terminal) — the only two reasons the conditional
      // `UPDATE` could have matched zero rows (decision 6). This is a clean,
      // deliberate outcome, not a crash — deliberately thrown inside this
      // `try` anyway (see the catch block's own guard against reconciling it).
      const mission = await missionRepository.getMission(userId, missionId);
      if (!mission) throw new MissionNotFoundError();
      throw new MissionAlreadyTerminalError();
    }

    const summary = await getMissionSummary(userId, missionId);
    if (!summary) throw new MissionNotFoundError();
    return summary;
  } catch (error) {
    // This function's own deliberate outcomes are never reconciled — see the
    // docstring above. Rethrow immediately, exactly as if no catch existed.
    if (
      error instanceof MissionAlreadyTerminalError ||
      error instanceof MissionNotFoundError ||
      error instanceof InvalidMissionTransitionError
    ) {
      throw error;
    }

    // Sprint-021: a genuinely unexpected error — reconcile via fresh reads,
    // read-only, no retry of the mutation (Scope item 3). `console.error`
    // keeps the swallowed failure observable in server logs; this sprint
    // adds no logging framework beyond that.
    console.error("setMissionStatus: reconciling after unexpected error", error);

    const mission = await missionRepository.getMission(userId, missionId);
    let decisionReconciled = true;
    if (activeDecision) {
      const decisionNow = await decisionRepository.getDecisionById(userId, activeDecision.id);
      decisionReconciled = decisionNow?.status === "ARCHIVED" || decisionNow?.status === "RESOLVED";
    }

    if (mission && mission.status === status && mission.outcomeAt !== null && decisionReconciled) {
      const summary = await getMissionSummary(userId, missionId);
      if (summary) return summary;
    }

    // Persisted state does not confirm this call's requested transition
    // actually committed — no guessing, no fabricated success.
    throw error;
  }
}

async function getMissionSummary(userId: string, missionId: string): Promise<MissionSummary | null> {
  const mission = await missionRepository.getMission(userId, missionId);
  if (!mission) return null;

  let decisions = await decisionRepository.getAllDecisionsForMission(userId, missionId);
  if (decisions.length === 0) {
    // Legacy backfill (pre-Sprint-003): zero Decisions ever, not "none
    // currently open" — see `decisionService.ensureDecisionForMission`.
    decisions = [await decisionService.ensureDecisionForMission(userId, missionId)];
  }

  const decisionIds = decisions.map((decision) => decision.id);
  // RFC-0001 §4 "Mission Journey" (Sprint-019): the Mission detail page is
  // the one place that needs every Decision's `recommendation` — fetched
  // here as a single batched query, never per-Decision.
  const [requestsByDecision, verdictsByDecision, activeDecision] = await Promise.all([
    axisRequestRepository.getRequestsForDecisions(userId, decisionIds),
    verdictRepository.getVerdictsForDecisions(userId, decisionIds),
    decisionRepository.getActiveDecisionForMission(userId, missionId),
  ]);
  const decisionSummaries = decisions.map((decision) =>
    decisionService.buildDecisionSummary(decision, requestsByDecision.get(decision.id) ?? []),
  );

  return buildMissionSummary(mission, decisionSummaries, activeDecision, verdictsByDecision);
}

/** RFC-0001 §4 "Mission Journey" (Sprint-019): deliberately issues zero
 * Verdict queries — neither `mission-card.tsx` (the list UI) nor
 * `opportunityService.deriveOpportunities` (the other consumer of this
 * function's output) ever reads `.decisions` or `.recommendation`, so
 * `buildMissionSummary` is called here without a `verdictsByDecision` map,
 * leaving every entry's `recommendation` `null` — harmless, since nothing
 * in this path displays it. Mission detail's `getMissionSummary` is the
 * only caller that pays for the batched Verdict fetch. */
async function listMissionSummaries(userId: string): Promise<MissionSummary[]> {
  const missions = await missionRepository.listMissionsForUser(userId);
  const missionIds = missions.map((mission) => mission.id);

  const decisionsByMission = await decisionRepository.getAllDecisionsForMissions(userId, missionIds);
  for (const missionId of missionIds) {
    if ((decisionsByMission.get(missionId) ?? []).length === 0) {
      // Legacy backfill — same one-time self-healing case as
      // getMissionSummary, per-mission since each is an independent write.
      decisionsByMission.set(missionId, [await decisionService.ensureDecisionForMission(userId, missionId)]);
    }
  }

  const allDecisionIds = [...decisionsByMission.values()].flat().map((decision) => decision.id);
  const requestsByDecision = await axisRequestRepository.getRequestsForDecisions(userId, allDecisionIds);
  const activeDecisionsByMission = await decisionRepository.getActiveDecisionsForMissions(userId, missionIds);

  return missions.map((mission) => {
    const decisions = decisionsByMission.get(mission.id) ?? [];
    const decisionSummaries = decisions.map((decision) =>
      decisionService.buildDecisionSummary(decision, requestsByDecision.get(decision.id) ?? []),
    );
    const activeDecision = activeDecisionsByMission.get(mission.id) ?? null;
    return buildMissionSummary(mission, decisionSummaries, activeDecision);
  });
}

export const missionService = {
  createMission,
  addMissionUpdate,
  setMissionStatus,
  getMissionSummary,
  listMissionSummaries,
  MissionNotFoundError,
  MissionNotActiveError,
  MissionAlreadyTerminalError,
  InvalidMissionTransitionError,
};
