import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { MissionWhy } from "./mission-why";
import { AtlasWorkingIndicator } from "./atlas-working-indicator";
import { renderLocalized } from "@/i18n/render";
import { missionStatusLabel } from "@/i18n/mission-status-label";
import { decisionStatusLabel } from "@/i18n/decision-status-label";
import type { MissionSummary } from "@/domain/mission";

interface MissionHeroProps {
  mission: MissionSummary;
  isFirstUpdate: boolean;
  /** Rendered inside the focus card, directly under the explanation —
   * used for the contextual "answer this" input when Atlas is blocked. */
  actionSlot?: React.ReactNode;
}

export async function MissionHero({ mission, isFirstUpdate, actionSlot }: MissionHeroProps) {
  const t = await getTranslations();
  const { currentFocus } = mission;
  const isActive = mission.status === "ACTIVE";

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-muted-foreground text-sm font-medium">{renderLocalized(t, mission.title)}</h1>
            {!isActive ? <Badge variant="secondary">{missionStatusLabel(t, mission.status)}</Badge> : null}
          </div>
          {isActive ? (
            currentFocus.blocked ? (
              <AtlasWorkingIndicator label={t("mission.hero.waitingForResponse")} />
            ) : (
              <Badge variant="outline">{t("mission.hero.readyToGo")}</Badge>
            )
          ) : null}
        </div>
        {isActive && mission.activeDecision ? (
          <p className="text-muted-foreground text-xs">
            {t("mission.decision.workingOn", {
              title: renderLocalized(t, mission.activeDecision.title),
              status: decisionStatusLabel(t, mission.activeDecision.status),
            })}
          </p>
        ) : null}
      </div>

      <div
        className={`flex flex-col gap-4 rounded-2xl border p-8 ${
          currentFocus.blocked ? "border-amber-500/40 bg-amber-500/5" : "bg-muted/40"
        }`}
      >
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          {!isActive
            ? t("mission.hero.wrappedUp")
            : currentFocus.blocked
              ? t("mission.hero.needsInput")
              : t("mission.hero.currentFocus")}
        </p>
        <p className="font-heading text-2xl leading-snug font-semibold sm:text-3xl">
          {renderLocalized(t, currentFocus.headline)}
        </p>
        {currentFocus.detail ? (
          <MissionWhy reasoning={renderLocalized(t, currentFocus.detail)} isFirstUpdate={isFirstUpdate} />
        ) : null}
        {/* Sprint-020 (RFC-0001 §4 "Mission Completion Semantics", scope 9):
         * shown only once the Mission is terminal — the date only if
         * `outcomeAt` was actually recorded (never `updatedAt` substituted,
         * Case F's legacy Missions render neither), the note only if
         * present, exactly as stored — no prefix, no `MissionWhy`, no
         * summarization, no attribution to Atlas. */}
        {!isActive && mission.outcomeAt ? (
          <p className="text-muted-foreground text-sm">
            {t(mission.status === "COMPLETED" ? "mission.outcome.completedOn" : "mission.outcome.abandonedOn", {
              date: new Date(mission.outcomeAt).toLocaleDateString(),
            })}
          </p>
        ) : null}
        {!isActive && mission.outcomeNote ? <p className="text-sm">{mission.outcomeNote}</p> : null}
        {actionSlot}
      </div>
    </section>
  );
}
