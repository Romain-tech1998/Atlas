import type { LocalizedText } from "@/i18n/message";

export type OpportunityEffort = "low" | "medium";

/** A real, computable nudge — never a fabricated cross-mission insight.
 * Atlas Brain doesn't reason about dependencies between missions today, so
 * every Opportunity is grounded in data that already exists: a sibling
 * mission that's blocked on a small detail from the user. */
export interface Opportunity {
  missionId: string;
  missionTitle: LocalizedText;
  reason: LocalizedText;
  effort: OpportunityEffort;
  impact: LocalizedText;
}
