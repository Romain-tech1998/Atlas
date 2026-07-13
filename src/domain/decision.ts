import type { AxisModuleId } from "@/domain/axis";
import type { AutomationLevel } from "@/brain/planning/types";
import type { LocalizedText } from "@/i18n/message";

/** RFC-0001 §4's Decision lifecycle. Sprint-003 only ever drives a Decision
 * through OPEN -> COLLECTING_INFORMATION -> RESOLVED/ARCHIVED — REASONING
 * and READY are reachable in the type for forward-compatibility with the
 * future Verdict engine (Sprint-004), but nothing sets them yet, since
 * nothing in Atlas Brain today actually reasons about options. */
export const DECISION_STATUSES = [
  "OPEN",
  "COLLECTING_INFORMATION",
  "REASONING",
  "READY",
  "RESOLVED",
  "ARCHIVED",
] as const;
export type DecisionStatusId = (typeof DECISION_STATUSES)[number];

/** What an update toward a Decision accomplished, relative to the blocker
 * state right before it ran. This is Sprint-002's `MissionUpdateOutcome`,
 * moved here now that the classification genuinely operates at Decision
 * level (a Mission's focus is just its active Decision's focus). The
 * persisted `LearningSignalType` values it maps to (`MISSION_BLOCKER_RESOLVED`
 * etc.) keep their Sprint-002 names — they're valid historical records of
 * what happened before Decision existed, not renamed alongside this. */
export const DECISION_UPDATE_OUTCOMES = ["blockerResolved", "unrelatedUpdate", "stillBlocked"] as const;
export type DecisionUpdateOutcome = (typeof DECISION_UPDATE_OUTCOMES)[number];

/** Pure: classifies a Decision update by comparing whether it was blocked
 * immediately before vs. immediately after re-running the pipeline. Never
 * inspects *which* field was missing — only whether the Decision was
 * waiting on anything at all. */
export function classifyDecisionUpdateOutcome(wasBlocked: boolean, isBlockedNow: boolean): DecisionUpdateOutcome {
  if (wasBlocked && !isBlockedNow) return "blockerResolved";
  if (!wasBlocked) return "unrelatedUpdate";
  return "stillBlocked";
}

/** RFC-0001 §4 "Verdict Acceptance" (Sprint-017): the Prisma-shaped values
 * (matches `DecisionResolutionOutcome` exactly, same convention as
 * `DecisionStatusId` mirroring `DecisionStatus`) — used at the
 * repository/row level. Distinct from `DecisionTimelineEntry`'s own
 * lowercase `"accepted" | "declined"`, which is the UI/service-facing
 * vocabulary (same split as `DecisionStatusId` vs. the lowercase
 * `DecisionUpdateOutcome` below). */
export type DecisionResolutionOutcomeId = "ACCEPTED" | "DECLINED";

/** One AxisRequest made toward a Decision, condensed for storytelling. */
export interface DecisionUpdateEntry {
  kind: "update";
  id: string;
  summary: LocalizedText;
  module: AxisModuleId;
  automationLevel: AutomationLevel;
  confidence: number;
  createdAt: string;
  /** null for the founding entry (Decision creation) — there's no "before"
   * blocker state to compare against, so it isn't an "update" outcome. */
  outcome: DecisionUpdateOutcome | null;
}

/** Sprint-017 (RFC-0001 §4 "Verdict Acceptance"): a synthetic, derived-on-
 * read entry appended by `buildDecisionSummary` when a Decision's
 * `resolutionOutcome` is set — never backed by an `AxisRequest`, since
 * accepting/declining a Verdict never runs the Axis pipeline. */
export interface DecisionResolutionEntry {
  kind: "resolution";
  id: string;
  outcome: "accepted" | "declined";
  /** Only ever non-null for `"declined"`. */
  note: string | null;
  createdAt: string;
}

/** Discriminated on `kind` — existing callers that only handled the
 * `"update"` shape (Sprint-002 through Sprint-016) must now branch on
 * `entry.kind` (see `MissionTimeline`); the `"update"` shape/meaning itself
 * is completely unchanged. */
export type DecisionTimelineEntry = DecisionUpdateEntry | DecisionResolutionEntry;

/** RFC-0001 §4 "Mission Journey" (Sprint-019): a coarser, presentation-only
 * 3-value grouping of `DecisionStatusId` — "is this Decision still being
 * worked, or is it done (one way or the other)?" Deliberately distinct from
 * `DecisionStatusId` itself (which stays exactly as Sprint-003 defined it)
 * and from `mission.currentFocus`'s own copy (`decisionStatusLabel`,
 * unchanged) — this is a new, coarser vocabulary for the Mission Journey's
 * section badges only, not a replacement for the granular status. */
export const DECISION_JOURNEY_STATUSES = ["active", "resolved", "archived"] as const;
export type DecisionJourneyStatus = (typeof DECISION_JOURNEY_STATUSES)[number];

/** Pure: `OPEN`/`COLLECTING_INFORMATION`/`REASONING`/`READY` all count as
 * "active" for Journey purposes — none of Sprint-018's sequential logic
 * needs a finer distinction here, and inventing one would be presentation
 * complexity with no product need behind it. */
export function computeDecisionJourneyStatus(status: DecisionStatusId): DecisionJourneyStatus {
  if (status === "RESOLVED") return "resolved";
  if (status === "ARCHIVED") return "archived";
  return "active";
}

/** The single most important thing to show the user right now, about the
 * Decision Atlas is actively working. */
export interface DecisionFocus {
  headline: LocalizedText;
  detail: LocalizedText | null;
  automationLevel: AutomationLevel;
  confidence: number;
  blocked: boolean;
  /** Raw field ids Atlas is waiting on (e.g. "dueDate"), present only when blocked. */
  missingFields: string[];
}

export interface DecisionSummary {
  id: string;
  missionId: string;
  title: LocalizedText;
  status: DecisionStatusId;
  createdAt: string;
  updatedAt: string;
  focus: DecisionFocus;
  updateCount: number;
  lastUpdatedAt: string;
  timeline: DecisionTimelineEntry[];
  /** RFC-0001 §4 "Mission Journey" (Sprint-019): a pure function of
   * `status` alone — set once in `decisionService.buildDecisionSummary`,
   * alongside `status` itself. */
  journeyStatus: DecisionJourneyStatus;
  /** Sprint-019: 1-based position among the Mission's Decisions, oldest
   * first. `decisionService.buildDecisionSummary` has no sibling context to
   * compute this honestly, so it sets a placeholder (`0`) here — never
   * displayed as-is. `missionService.buildMissionSummary` immediately
   * overwrites it on every entry before the array is ever returned to a
   * caller (see that function for why this needs Mission-level context). */
  number: number;
  /** Sprint-019: whether this IS the Mission's currently open Decision.
   * Placeholder (`false`) here for the same reason as `number` — only
   * `missionService.buildMissionSummary` knows which sibling is active. */
  isActive: boolean;
  /** Sprint-019: the Decision's persisted Verdict recommendation, populated
   * only when that Verdict's `status === "PRODUCED"` — `null` otherwise,
   * including "not fetched at all" (`missionService.listMissionSummaries`
   * never queries Verdicts — see that function's loading-strategy split).
   * Placeholder (`null`) here; only `getMissionSummary`'s call path ever
   * overwrites it with a real value. Never fabricated from `timeline` or
   * a resolution note — this is the one genuinely new piece of information
   * this sprint adds, and it comes from exactly one place: the Verdict row. */
  recommendation: LocalizedText | null;
}

/** A single factual item attached to a Decision (RFC-0001 §4). What "counts
 * as Evidence" in Sprint-004: any short, user-entered fact plus where it
 * came from — no validation of truth, relevance, or quality is attempted;
 * that judgment belongs to a future recommendation engine, not this sprint. */
export interface EvidenceItem {
  id: string;
  claim: string;
  source: string;
  observedAt: string;
  createdAt: string;
  /** Optional free-form structured detail (Sprint-004) — read-only input to
   * `normalizeEvidence` (Sprint-005, `src/domain/evidence-normalization.ts`).
   * Untyped here on purpose: its shape is never validated or enforced,
   * only opportunistically read. */
  metadata: unknown;
}

/** Sprint-006 is the first sprint that ever sets `PRODUCED` (see
 * VerdictSummary and evidenceService), and only via the `find_lowest_value`
 * Skill's deterministic result — never a guess. */
export const VERDICT_STATUSES = ["INSUFFICIENT_EVIDENCE", "PRODUCED"] as const;
export type VerdictStatusId = (typeof VERDICT_STATUSES)[number];

export interface VerdictSummary {
  status: VerdictStatusId;
  /** Null while INSUFFICIENT_EVIDENCE. */
  recommendation: LocalizedText | null;
  reasoning: LocalizedText | null;
  /** How much Evidence backs this Verdict — NEVER a measure of parsing
   * confidence (RFC-0001 §4/§5), and never rendered as if it were a
   * percentage confidence in the recommendation. See
   * `computeEvidenceCoverage` for how this is derived. Unchanged by
   * Sprint-006 — still purely a quantity signal, never repurposed to mean
   * anything about the reasoning result below. */
  evidenceCoverage: number | null;
  evidenceCount: number;
  /** Sprint-006: the Evidence ids the `find_lowest_value` Skill actually
   * compared to produce this Verdict — null while INSUFFICIENT_EVIDENCE.
   * This is what lets the UI show "Why?" (RFC-0001 §4 traceability). */
  comparedEvidenceIds: string[] | null;
  /** Sprint-030: populated only when this Verdict came from `compare_options`
   * (RFC-0003 §7a) — null for every `find_lowest_value` Verdict, including
   * every one that predates this sprint. Not yet rendered anywhere (Sprint-031
   * adds the UI); exists now so the data survives a page reload once
   * Sprint-031 needs it, same "persist before the UI needs it, once the shape
   * is settled" timing `comparedEvidenceIds` itself followed relative to its
   * own consumer. */
  ranking: Array<{ optionLabel: string; score: number }> | null;
}

/** Evidence quantity saturates at this many items — an arbitrary,
 * deliberately simple cap, not a claim that 5 facts make a "complete"
 * case. Exists only so the number doesn't grow unbounded. */
const EVIDENCE_COVERAGE_CAP = 5;

/** Pure, deliberately naive placeholder: `min(count / cap, 1)`. This is NOT
 * a confidence score — it says nothing about whether the Evidence is
 * correct, relevant, or sufficient to actually recommend something, only
 * how many discrete facts have been recorded. Must never be computed from,
 * or resemble, `scoringEngine`'s parsing-stage confidence (RFC-0001 §4/§5).
 * Returns null for zero Evidence: null means "not applicable yet"; 0 could
 * misread as "0% confident", which would itself be a fabricated-precision
 * claim the product doctrine forbids. */
export function computeEvidenceCoverage(evidenceCount: number): number | null {
  if (evidenceCount === 0) return null;
  return Math.min(evidenceCount / EVIDENCE_COVERAGE_CAP, 1);
}
