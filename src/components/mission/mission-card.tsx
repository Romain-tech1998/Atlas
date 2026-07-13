import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { relativeTime } from "@/lib/relative-time";
import { renderLocalized } from "@/i18n/render";
import { missionStatusLabel } from "@/i18n/mission-status-label";
import type { MissionSummary } from "@/domain/mission";

interface MissionCardProps {
  mission: MissionSummary;
}

export async function MissionCard({ mission }: MissionCardProps) {
  const now = new Date();
  const locale = await getLocale();
  const t = await getTranslations();
  const isWaiting = mission.status === "ACTIVE" && mission.currentFocus.blocked;

  return (
    <Link href={`/missions/${mission.id}`} className="block">
      <Card
        className={`transition-colors hover:border-foreground/30 ${
          isWaiting ? "border-amber-500/40 bg-amber-500/5" : ""
        }`}
      >
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base leading-snug">{renderLocalized(t, mission.title)}</CardTitle>
            {mission.status !== "ACTIVE" ? (
              <Badge variant="secondary">{missionStatusLabel(t, mission.status)}</Badge>
            ) : isWaiting ? (
              <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
                {t("mission.card.waitingOnYou")}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="font-medium">{renderLocalized(t, mission.currentFocus.headline)}</p>
          <p className="text-muted-foreground text-xs">
            {t("mission.card.meta", {
              count: mission.updateCount,
              time: relativeTime(mission.lastUpdatedAt, now, locale, t("common.justNow")),
            })}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
