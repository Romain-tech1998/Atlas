import { atlasBrain } from "@/services/atlasBrain";
import { decisionRepository, OpenDecisionExistsError, type DecisionRow } from "@/services/decisionRepository";
import { missionRepository } from "@/services/missionRepository";
import { axisRequestRepository } from "@/services/axisRequestRepository";
import { verdictRepository } from "@/services/verdictRepository";
import { learningRepository } from "@/brain/learning/learningRepository";
import { localized } from "@/i18n/message";
import { rawLocalizedText } from "@/i18n/render";
import { classifyDecisionUpdateOutcome, computeDecisionJourneyStatus } from "@/domain/decision";
import type { AxisPipelineResult } from "@/brain/types";
import type { LearningSignalTypeId } from "@/brain/learning/types";
import type {
  DecisionFocus,
  DecisionStatusId,
  DecisionSummary,
  DecisionUpdateOutcome,
  DecisionResolutionOutcomeId,
  DecisionTimelineEntry,
} from "@/domain/decision";

class DecisionNotFoundError extends Error {
  constructor() {
    super("Decision not found");
  }
}

/** Sprint-018: mirrors `missionService.MissionNotFoundError` — same
 * concept, declared again in this module rather than imported, the same
 * per-module-error-class convention `decisionService`/`evidenceService`
 * already both follow for "Decision not found" (see Sprint-017's review). */
class MissionNotFoundError extends Error {
  constructor() {
    super("Mission not found");
  }
}

/** RFC-0001 §4 "Sequential Multi-Decision Missions" (Sprint-018, correction
 * 3): surfaced when starting the Mission's next Decision loses a genuine
 * race — either Postgres aborted one of two concurrent `Serializable`
 * transactions (Prisma error code `P2034`), or `createNextDecision`'s own
 * re-check found an open Decision already there. Either way, the honest
 * response is "try again," never a silent duplicate and never an
 * unhandled 500. */
class ConcurrentDecisionCreationError extends Error {
  constructor() {
    super("Another update already started the next Decision for this Mission — please try again");
  }
}

/** Sprint-017: the Accept/Decline flow only exists once Atlas has actually
 * recommended something — a Decision with no Verdict, or a Verdict still
 * `INSUFFICIENT_EVIDENCE`, has nothing for the user to accept or decline. */
class VerdictNotProducedError extends Error {
  constructor() {
    super("Verdict not produced");
  }
}

/** Sprint-017: resolving is a one-time event — `RESOLVED` is a terminal
 * state this sprint never re-opens (declining doesn't trigger new
 * reasoning, so there's nothing to resolve a second time). */
class DecisionAlreadyResolvedError extends Error {
  constructor() {
    super("Decision already resolved");
  }
}

/** Sprint-017: `"declined"` requires the user's own account of what
 * happened instead — never left blank, never inferred. */
class InvalidResolutionInputError extends Error {}

/** `requests` is oldest-first. Looking one step back (not just at the
 * latest request) is what lets a still-blocked Decision get an honest
 * "thanks, still waiting on X" headline instead of repeating the first-ask
 * copy verbatim. This is Sprint-002's Mission-level `computeCurrentFocus`,
 * moved here and keyed to `DecisionStatusId` — Current Focus belongs to a
 * Decision, never to the Mission directly (RFC-0001 §4, Sprint-003).
 * Message keys stay under `mission.currentFocus.*`: that describes *where*
 * this copy is shown (the Mission page's Current Focus block, unchanged
 * since Sprint-001.5), not which module computes it — renaming them would
 * be pure churn with no user-visible benefit. */
function computeDecisionFocus(
  status: DecisionStatusId,
  requests: AxisPipelineResult[],
  resolutionOutcome: DecisionResolutionOutcomeId | null = null,
): DecisionFocus {
  const latestRequest = requests[requests.length - 1];
  const previousRequest = requests[requests.length - 2];

  if (status === "RESOLVED") {
    // Sprint-017: differentiate accepted/declined once we know which — the
    // generic "done" copy remains the fallback for a Decision resolved
    // before this sprint existed (or via any future non-Verdict path, e.g.
    // `missionService.setMissionStatus`), where `resolutionOutcome` is null.
    const headlineKey =
      resolutionOutcome === "ACCEPTED"
        ? "mission.currentFocus.doneAccepted"
        : resolutionOutcome === "DECLINED"
          ? "mission.currentFocus.doneDeclined"
          : "mission.currentFocus.done";
    return {
      headline: localized(headlineKey),
      detail: null,
      automationLevel: latestRequest?.plan.automationLevel ?? "manual",
      confidence: latestRequest?.score.overallScore ?? 0,
      blocked: false,
      missingFields: [],
    };
  }

  if (status === "ARCHIVED") {
    return {
      headline: localized("mission.currentFocus.abandoned"),
      detail: null,
      automationLevel: latestRequest?.plan.automationLevel ?? "manual",
      confidence: latestRequest?.score.overallScore ?? 0,
      blocked: false,
      missingFields: [],
    };
  }

  if (!latestRequest) {
    return {
      headline: localized("mission.currentFocus.gettingStarted"),
      detail: null,
      automationLevel: "manual",
      confidence: 0,
      blocked: false,
      missingFields: [],
    };
  }

  const { plan, routing, score } = latestRequest;

  if (plan.missingInfo.length > 0) {
    const wasBlockedBefore = previousRequest ? previousRequest.plan.missingInfo.length > 0 : false;
    const headlineKey = wasBlockedBefore ? "mission.currentFocus.stillNeedsField" : "mission.currentFocus.needsField";
    return {
      headline: localized(headlineKey, { field: plan.missingInfo[0] }),
      detail: routing.reasoning,
      automationLevel: plan.automationLevel,
      confidence: score.overallScore,
      blocked: true,
      missingFields: plan.missingInfo,
    };
  }

  const nextStep = plan.steps[0];
  return {
    headline: nextStep ? nextStep.description : localized("mission.currentFocus.nothingPending"),
    detail: routing.reasoning,
    automationLevel: plan.automationLevel,
    confidence: score.overallScore,
    blocked: false,
    missingFields: [],
  };
}

const OUTCOME_SIGNAL_TYPES: Record<DecisionUpdateOutcome, LearningSignalTypeId> = {
  blockerResolved: "mission_blocker_resolved",
  unrelatedUpdate: "mission_update_unrelated",
  stillBlocked: "mission_still_blocked",
};

/** Pure: turns a Decision row + its ordered AxisRequests into the summary
 * the Mission page derives its Current Focus and Timeline from. */
function buildDecisionSummary(decision: DecisionRow, requests: AxisPipelineResult[]): DecisionSummary {
  const latestRequest = requests[requests.length - 1];

  const timeline: DecisionTimelineEntry[] = requests.map((request, index) => {
    const previous = requests[index - 1];
    const outcome = previous
      ? classifyDecisionUpdateOutcome(previous.plan.missingInfo.length > 0, request.plan.missingInfo.length > 0)
      : null;

    return {
      kind: "update",
      id: request.id,
      summary: request.summary,
      module: request.routing.chosenModule,
      automationLevel: request.plan.automationLevel,
      confidence: request.score.overallScore,
      createdAt: request.createdAt,
      outcome,
    };
  });

  // Sprint-017: a synthetic final entry, derived directly from the Decision
  // row's own resolution fields — never backed by an AxisRequest, since
  // accepting/declining never runs the Axis pipeline (RFC-0001 §4).
  if (decision.resolutionOutcome) {
    timeline.push({
      kind: "resolution",
      id: `${decision.id}-resolution`,
      outcome: decision.resolutionOutcome === "ACCEPTED" ? "accepted" : "declined",
      note: decision.resolutionNote,
      createdAt: decision.updatedAt.toISOString(),
    });
  }

  return {
    id: decision.id,
    missionId: decision.missionId,
    title: decision.title ?? rawLocalizedText(""),
    status: decision.status,
    createdAt: decision.createdAt.toISOString(),
    updatedAt: decision.updatedAt.toISOString(),
    focus: computeDecisionFocus(decision.status, requests, decision.resolutionOutcome),
    updateCount: requests.length,
    lastUpdatedAt: latestRequest?.createdAt ?? decision.createdAt.toISOString(),
    timeline,
    // RFC-0001 §4 "Mission Journey" (Sprint-019): journeyStatus needs no
    // Mission context — computed here, alongside status itself. number/
    // isActive/recommendation do need Mission-level sibling context this
    // function doesn't have; these are safe placeholders, always
    // overwritten by missionService.buildMissionSummary before any caller
    // sees them (see that function, and DecisionSummary's own field docs).
    journeyStatus: computeDecisionJourneyStatus(decision.status),
    number: 0,
    isActive: false,
    recommendation: null,
  };
}

/** Creates a Decision for a Mission and runs the founding Axis pipeline
 * pass, attaching it to the new Decision — the Sprint-003 scope is exactly
 * one Decision per Mission, created atomically with it. */
async function createDecisionForMission(
  userId: string,
  missionId: string,
  rawInput: string,
): Promise<{ decision: DecisionRow; result: AxisPipelineResult }> {
  const decision = await decisionRepository.createDecision(userId, missionId);
  const result = await atlasBrain.runPipeline(userId, rawInput, missionId, decision.id);
  await decisionRepository.setDecisionTitle(decision.id, result.summary);
  await decisionRepository.setDecisionStatus(decision.id, "COLLECTING_INFORMATION");
  return { decision: { ...decision, title: result.summary, status: "COLLECTING_INFORMATION" }, result };
}

/**
 * RFC-0001 §4 "Sequential Multi-Decision Missions" (Sprint-018): narrowed to
 * exactly one case — a Mission with **zero Decisions ever** (pre-Sprint-003
 * legacy data), re-parenting its orphaned AxisRequests onto a newly created
 * Decision so their history isn't lost. This must NOT be called, and must
 * not fire, merely because the Mission's most recent Decision is resolved
 * — that is ordinary post-Sprint-017 state (`activeDecision: null`), not a
 * legacy-repair case. Every call site (`missionService.getMissionSummary`/
 * `listMissionSummaries`/`addMissionUpdate`) checks
 * `decisionRepository.getAllDecisionsForMission(s)` itself and only calls
 * this when that list is empty — never based on `getActiveDecisionForMission`
 * alone.
 *
 * The check-then-create itself goes through `decisionRepository.
 * ensureFirstDecision`'s Serializable transaction, not a plain read-then-
 * write — verified necessary in practice, not just in theory: the Mission
 * page calls `getMissionSummary` and `listMissionSummaries` concurrently via
 * `Promise.all`, and both independently see "zero Decisions" for the same
 * never-before-opened legacy Mission on its first load. Only the call that
 * actually created the row (`created: true`) does the re-parenting/title/
 * status work below; a call that lost the race (`created: false`) returns
 * the other's Decision untouched, never repeating the backfill.
 */
async function ensureDecisionForMission(userId: string, missionId: string): Promise<DecisionRow> {
  const { decision, created } = await decisionRepository.ensureFirstDecision(userId, missionId);
  if (!created) return decision;

  await axisRequestRepository.attachOrphanedRequestsToDecision(userId, missionId, decision.id);

  const requests = await axisRequestRepository.getRequestsForDecision(userId, decision.id);
  const latestRequest = requests[requests.length - 1];
  if (latestRequest) {
    await decisionRepository.setDecisionTitle(decision.id, latestRequest.summary);
  }
  await decisionRepository.setDecisionStatus(decision.id, "COLLECTING_INFORMATION");

  return {
    ...decision,
    title: latestRequest?.summary ?? decision.title,
    status: "COLLECTING_INFORMATION",
  };
}

/**
 * RFC-0001 §4 "Sequential Multi-Decision Missions" (Sprint-018): starts the
 * Mission's next Decision — called only when an explicit user update
 * arrives and the Mission has Decisions but none currently open (Branch B,
 * `missionService.addMissionUpdate`). Mirrors `createDecisionForMission`'s
 * shape/sequencing exactly, with one structural difference: the
 * check-that-none-is-open/create step is a `Serializable` transaction
 * (`decisionRepository.createNextDecision`), since two near-simultaneous
 * updates racing to start "the next Decision" is a real scenario
 * `createDecisionForMission` (called exactly once, atomically with a brand
 * new Mission) never had to consider. The pipeline run itself happens
 * *outside* that transaction, same as `createDecisionForMission` — it
 * doesn't need Serializable's guarantee, only the existence check does.
 */
async function startNextDecision(
  userId: string,
  missionId: string,
  rawInput: string,
): Promise<{ decision: DecisionRow; result: AxisPipelineResult }> {
  const mission = await missionRepository.getMission(userId, missionId);
  if (!mission) throw new MissionNotFoundError();

  let decision: DecisionRow;
  try {
    decision = await decisionRepository.createNextDecision(userId, missionId);
  } catch (error) {
    // `createNextDecision` itself normalizes every failure mode it can
    // positively confirm was a lost race (Postgres's clean P2034
    // serialization failure, or the rougher connection-level errors
    // observed in practice) into `OpenDecisionExistsError` — anything else
    // is a genuine failure and is not masked here.
    if (error instanceof OpenDecisionExistsError) throw new ConcurrentDecisionCreationError();
    throw error;
  }

  // The Decision row must exist before the pipeline persists its founding
  // AxisRequest (AxisRequest.decisionId references a real row) — never the
  // previous, now-closed Decision, even momentarily.
  const result = await atlasBrain.runPipeline(userId, rawInput, missionId, decision.id);
  await decisionRepository.setDecisionTitle(decision.id, result.summary);
  await decisionRepository.setDecisionStatus(decision.id, "COLLECTING_INFORMATION");

  return { decision: { ...decision, title: result.summary, status: "COLLECTING_INFORMATION" }, result };
}

/**
 * Runs another Axis pipeline pass toward an existing Decision. When the
 * Decision is blocked on a missing detail, the raw answer alone (e.g.
 * "next Friday") usually won't re-trigger the same intent on its own — so
 * it's combined with the request that's still waiting, the same way a
 * person would repeat themselves with the missing detail added. The
 * Intent/Entity Engines are unchanged; this only changes what text they're
 * asked to read. (Adapted from Sprint-002's `missionService.addMissionUpdate`.)
 *
 * After the pipeline re-runs, classifies what the update actually
 * accomplished (see `classifyDecisionUpdateOutcome`) by comparing the
 * blocked state before and after, and records that as a learning signal.
 */
async function addDecisionUpdate(
  userId: string,
  missionId: string,
  decision: DecisionRow,
  rawInput: string,
): Promise<AxisPipelineResult> {
  const requests = await axisRequestRepository.getRequestsForDecision(userId, decision.id);
  const latestRequest = requests[requests.length - 1];
  const focus = computeDecisionFocus(decision.status, requests);
  const wasBlocked = focus.blocked;

  const effectiveInput = wasBlocked && latestRequest ? `${latestRequest.rawInput} ${rawInput}` : rawInput;

  const result = await atlasBrain.runPipeline(userId, effectiveInput, missionId, decision.id);

  const outcome = classifyDecisionUpdateOutcome(wasBlocked, result.plan.missingInfo.length > 0);
  await learningRepository.saveSignals(userId, result.id, [
    {
      type: OUTCOME_SIGNAL_TYPES[outcome],
      payload: {
        missionId,
        decisionId: decision.id,
        missingFieldsBefore: focus.missingFields,
        missingFieldsAfter: result.plan.missingInfo,
      },
    },
  ]);

  return result;
}

/**
 * Sprint-017 (RFC-0001 §4 "Verdict Acceptance"). The only way a Decision
 * reaches `RESOLVED` through an explicit user action — accepting Atlas's
 * recommendation, or recording that a different outcome happened instead.
 * Never touches the Verdict row itself: `Verdict.recommendation`/`reasoning`
 * stay exactly as `find_lowest_value` produced them, a historical record of
 * what Atlas once recommended, not a live value declining revises.
 */
async function resolveDecision(
  userId: string,
  decisionId: string,
  input: { outcome: "accepted" | "declined"; note?: string },
): Promise<void> {
  const decision = await decisionRepository.getDecisionById(userId, decisionId);
  if (!decision) throw new DecisionNotFoundError();

  if (decision.status === "RESOLVED") throw new DecisionAlreadyResolvedError();

  const verdict = await verdictRepository.getVerdictForDecision(userId, decisionId);
  if (!verdict || verdict.status !== "PRODUCED") throw new VerdictNotProducedError();

  const note = input.note?.trim();
  if (input.outcome === "declined" && !note) {
    throw new InvalidResolutionInputError("note is required when declining");
  }

  await decisionRepository.resolveDecision(decisionId, {
    outcome: input.outcome === "accepted" ? "ACCEPTED" : "DECLINED",
    // "accepted" ignores any supplied note — only "declined" ever persists one.
    note: input.outcome === "declined" ? note : undefined,
  });

  const signalType: LearningSignalTypeId = input.outcome === "accepted" ? "verdict_accepted" : "verdict_declined";
  await learningRepository.saveSignals(userId, null, [
    { type: signalType, payload: { decisionId, missionId: decision.missionId } },
  ]);
}

export const decisionService = {
  computeDecisionFocus,
  buildDecisionSummary,
  createDecisionForMission,
  ensureDecisionForMission,
  startNextDecision,
  addDecisionUpdate,
  resolveDecision,
  DecisionNotFoundError,
  MissionNotFoundError,
  ConcurrentDecisionCreationError,
  VerdictNotProducedError,
  DecisionAlreadyResolvedError,
  InvalidResolutionInputError,
};
