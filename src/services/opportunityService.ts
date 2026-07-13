import { localized } from "@/i18n/message";
import type { MissionSummary } from "@/domain/mission";
import type { Opportunity } from "@/domain/opportunity";

const MAX_OPPORTUNITIES = 3;

/**
 * Pure: surfaces other active missions that are blocked on a small detail
 * from the user. This is intentionally narrow — Atlas Brain has no concept
 * of dependencies between missions or real-world entities, so an
 * Opportunity never claims more insight than "this other thing of yours
 * is waiting on you and would take little effort to unblock." Operates on
 * already-fetched MissionSummary[]; no Prisma access of its own.
 */
export function deriveOpportunities(missions: MissionSummary[], excludeMissionId?: string): Opportunity[] {
  return missions
    .filter((mission) => mission.id !== excludeMissionId)
    .filter((mission) => mission.status === "ACTIVE" && mission.currentFocus.blocked)
    .slice(0, MAX_OPPORTUNITIES)
    .map((mission) => ({
      missionId: mission.id,
      missionTitle: mission.title,
      reason: localized("opportunity.reasonWaitingOn", { field: mission.currentFocus.missingFields[0] }),
      effort: mission.currentFocus.missingFields.length <= 1 ? "low" : "medium",
      impact: localized("opportunity.impactUnblocks"),
    }));
}

export const opportunityService = { deriveOpportunities };
