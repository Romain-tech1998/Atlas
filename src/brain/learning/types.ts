import type { IntentResult } from "@/brain/intent/types";
import type { EntityResult } from "@/brain/entity/types";
import type { ContextBundle } from "@/brain/context/types";
import type { RoutingResult } from "@/brain/routing/types";
import type { ExecutionPlan } from "@/brain/planning/types";
import type { ScoreBreakdown } from "@/brain/scoring/types";

/**
 * The signal types Atlas Brain can record. The first six are emitted
 * automatically by the pipeline on every request. `user_*` are emitted
 * outside the pipeline when a user reacts to a result (accepts, rejects,
 * edits, or abandons it — `user_modified_output`/`user_feedback_negative`
 * aren't wired to an endpoint yet). `mission_*` are emitted by
 * `decisionService` after classifying what an update to a Decision
 * accomplished (see `classifyDecisionUpdateOutcome` in
 * `src/domain/decision.ts`) — these are Decision-progress signals, not
 * pipeline-internal ones, so they're recorded post-hoc against the new
 * `AxisRequest` the update produced. Named `mission_*` because they were
 * introduced in Sprint-002 before Decision existed (RFC-0001 §4,
 * Sprint-003) — kept as historical names rather than renamed. `evidence_added`
 * (Sprint-004) is recorded by `evidenceService` when a new Evidence item is
 * attached to a Decision — not tied to any pipeline run, so it's saved
 * with a null `axisRequestId` (see `learningRepository.saveSignals`).
 * `verdict_accepted`/`verdict_declined` (Sprint-017) are recorded by
 * `decisionService.resolveDecision` when the user explicitly accepts or
 * declines a `PRODUCED` Verdict — also not tied to a pipeline run, same
 * null-`axisRequestId` convention as `evidence_added`.
 */
export const LEARNING_SIGNAL_TYPES = [
  "request_created",
  "intent_detected",
  "entity_extracted",
  "context_used",
  "module_suggested",
  "plan_generated",
  "user_feedback_positive",
  "user_feedback_negative",
  "user_modified_output",
  "user_abandoned_flow",
  "mission_blocker_resolved",
  "mission_update_unrelated",
  "mission_still_blocked",
  "evidence_added",
  "verdict_accepted",
  "verdict_declined",
] as const;

export type LearningSignalTypeId = (typeof LEARNING_SIGNAL_TYPES)[number];

export interface LearningSignalDraft {
  type: LearningSignalTypeId;
  payload: Record<string, unknown>;
}

/** Everything the pipeline computed for one request, used to derive signals. */
export interface PipelineTrace {
  rawInput: string;
  intent: IntentResult;
  entities: EntityResult;
  context: ContextBundle;
  routing: RoutingResult;
  plan: ExecutionPlan;
  score: ScoreBreakdown;
}
