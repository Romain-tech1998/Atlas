import type { DecisionJourneyStatus } from "@/domain/decision";

type Translator = (key: string) => string;

/** RFC-0001 §4 "Mission Journey" (Sprint-019): same "static key lookup"
 * convention as `decisionStatusLabel` — that file stays exactly as is,
 * still used by `mission-hero.tsx`'s granular "workingOn" subtitle. This is
 * a separate, coarser 3-value vocabulary for the Journey's section badges. */
export function decisionJourneyStatusLabel(t: Translator, status: DecisionJourneyStatus): string {
  switch (status) {
    case "active":
      return t("mission.journey.status.active");
    case "resolved":
      return t("mission.journey.status.resolved");
    case "archived":
      return t("mission.journey.status.archived");
  }
}
