import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { missionService } from "@/services/missionService";
import { opportunityService } from "@/services/opportunityService";
import { MissionCard } from "@/components/mission/mission-card";
import { OpportunityList } from "@/components/mission/opportunity-list";
import { MissionCreation } from "./mission-creation";

export default async function HomePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const missions = await missionService.listMissionSummaries(session.user.id);
  const activeMissions = missions.filter((mission) => mission.status === "ACTIVE");
  const otherMissions = missions.filter((mission) => mission.status !== "ACTIVE");
  const blockedCount = activeMissions.filter((mission) => mission.currentFocus.blocked).length;
  const opportunities = opportunityService.deriveOpportunities(missions);

  if (missions.length === 0) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <MissionCreation />
      </main>
    );
  }

  const t = await getTranslations("home");

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-10 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold">{t("missions.title")}</h1>
        <p className="text-muted-foreground text-sm">
          {t("missions.status", { activeCount: activeMissions.length, blockedCount })}
        </p>
      </div>

      <MissionCreation variant="compact" />

      {activeMissions.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {activeMissions.map((mission) => (
            <MissionCard key={mission.id} mission={mission} />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">{t("missions.noActive")}</p>
      )}

      <OpportunityList opportunities={opportunities} title={t("recommends")} />

      {otherMissions.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-muted-foreground text-sm font-medium uppercase tracking-wide">
            {t("missions.completedAbandoned")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {otherMissions.map((mission) => (
              <MissionCard key={mission.id} mission={mission} />
            ))}
          </div>
        </div>
      ) : null}
    </main>
  );
}
