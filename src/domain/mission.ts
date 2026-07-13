import type { LocalizedText } from "@/i18n/message";
import type { DecisionFocus, DecisionStatusId, DecisionSummary, DecisionTimelineEntry } from "@/domain/decision";

export const MISSION_STATUSES = ["ACTIVE", "COMPLETED", "ABANDONED"] as const;
export type MissionStatusId = (typeof MISSION_STATUSES)[number];

/** The Mission's single active Decision, exposed just enough to caption
 * "what Atlas is currently working on" naturally (RFC-0001 §4) — never as
 * a raw technical object. Sprint-003 scope: a Mission always has exactly
 * one Decision, so this is that Decision, not a list. */
export interface MissionActiveDecision {
  id: string;
  title: LocalizedText;
  status: DecisionStatusId;
}

/** RFC-0001 §4 "Mission Completion Semantics" (Sprint-020, correction 1): a
 * Mission-level fact, deliberately NOT a member of `DecisionTimelineEntry` —
 * a Mission's own outcome doesn't belong nested inside any Decision-scoped
 * component (same "Mission remains primary" principle Sprint-018/019
 * already settled). `id` is rendering identity only (`${mission.id}-outcome`),
 * never persisted — there is no `MissionOutcome` row. */
export interface MissionOutcomeEntry {
  kind: "mission-outcome";
  id: string;
  outcome: "completed" | "abandoned";
  /** Only ever non-null if the user supplied one at the time of transition. */
  note: string | null;
  createdAt: string;
}

export interface MissionSummary {
  id: string;
  /** The user's original raw intention, verbatim — never translated. */
  goal: string;
  title: LocalizedText;
  status: MissionStatusId;
  createdAt: string;
  updatedAt: string;
  /** Sprint-020 (RFC-0001 §4 "Mission Completion Semantics"): set only when
   * an explicit user action transitioned this Mission to `COMPLETED`/
   * `ABANDONED` — `null` while `ACTIVE`, and `null` forever for a Mission
   * that reached a terminal status before this sprint shipped (legacy —
   * rendered honestly, never backfilled or fabricated). */
  outcomeAt: string | null;
  outcomeNote: string | null;
  /** RFC-0001 §4 "Sequential Multi-Decision Missions" (Sprint-018):
   * derived from the Mission's most recently *created* Decision, whether
   * still open or already resolved — deliberately NOT a pass-through of
   * `activeDecision`'s own focus. If it were, a just-resolved Decision's
   * "Done — accepted" headline (Sprint-017) would vanish the instant
   * `activeDecision` goes null, before the user's next message even
   * arrives. See `missionService.buildMissionSummary`. */
  currentFocus: DecisionFocus;
  /** Sprint-018: totals across every Decision the Mission has ever had,
   * not just the currently active one. */
  updateCount: number;
  lastUpdatedAt: string;
  /** Sprint-018: Mission-scoped, not Decision-scoped — the concatenation
   * of every one of the Mission's Decisions' own (already-ordered)
   * timelines, oldest Decision first. A Mission with several Decisions
   * shows its complete history here, not just the currently active one's. */
  timeline: DecisionTimelineEntry[];
  /** RFC-0001 §4 (Sprint-018): the Mission's currently open Decision —
   * `null` between a resolution and the user's next update, or before the
   * Mission's first Decision has ever started. Specifically the open one
   * and nothing else; never conflated with `currentFocus` (above), which
   * reads the latest Decision regardless of open/resolved state. */
  activeDecision: MissionActiveDecision | null;
  /** RFC-0001 §4 "Mission Journey" (Sprint-019): every one of the Mission's
   * Decisions, oldest first, each with `number`/`isActive`/`recommendation`
   * already resolved by `missionService.buildMissionSummary` — the source
   * the Mission Journey UI (`DecisionCard`) renders directly, one section
   * per entry. Not a parallel type: this is the same `DecisionSummary`
   * `currentFocus`/`timeline` above are themselves derived from. */
  decisions: DecisionSummary[];
  /** Sprint-020 (RFC-0001 §4 "Mission Completion Semantics", correction 1):
   * non-null only when the Mission is terminal AND `outcomeAt` is set (a
   * legacy terminal Mission with no recorded `outcomeAt` renders no entry
   * at all — Case F). Rendered by `page.tsx` as its own element, outside
   * every `DecisionCard`. */
  outcomeEntry: MissionOutcomeEntry | null;
}
