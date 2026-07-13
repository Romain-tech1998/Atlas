import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { relativeTime } from "@/lib/relative-time";
import { renderLocalized } from "@/i18n/render";
import type { DecisionTimelineEntry } from "@/domain/decision";

interface MissionTimelineProps {
  /** Sprint-018: Mission-scoped, not Decision-scoped — the concatenation of
   * every one of the Mission's Decisions' own timelines, oldest first
   * (`missionService.buildMissionSummary`). The most recent entry across
   * the whole stream is shown by Current Focus already, so this renders
   * everything before it — history in a supporting role, not a repeat of
   * "now" — the same "hide only the single trailing entry" rule as before,
   * just applied to the full multi-Decision array. */
  entries: DecisionTimelineEntry[];
}

export async function MissionTimeline({ entries }: MissionTimelineProps) {
  const now = new Date();
  const locale = await getLocale();
  const t = await getTranslations();

  // Sprint-017: the last "update" entry is still hidden — Current Focus
  // already shows it (unchanged reasoning). But a trailing "resolution"
  // entry is never hidden: Current Focus's accepted/declined headline
  // doesn't carry the decline note, so this is the only place it's shown.
  const lastEntry = entries[entries.length - 1];
  const history = lastEntry?.kind === "update" ? entries.slice(0, -1) : entries;

  if (history.length === 0) {
    return <p className="text-muted-foreground text-xs">{t("mission.timeline.started")}</p>;
  }

  return (
    <ol className="flex flex-col gap-4">
      {history.map((entry, index) => (
        <li key={entry.id} className="relative flex gap-3 pl-1">
          <div className="flex flex-col items-center">
            <span className="bg-muted-foreground/30 mt-1 size-1.5 shrink-0 rounded-full" />
            {index < history.length - 1 ? <span className="bg-border mt-1 w-px flex-1" /> : null}
          </div>
          <div className="text-muted-foreground flex flex-1 flex-wrap items-baseline gap-2 pb-1 text-xs">
            {entry.kind === "update" ? (
              <>
                <span>{renderLocalized(t, entry.summary)}</span>
                <span>·</span>
                <span>{relativeTime(entry.createdAt, now, locale, t("common.justNow"))}</span>
                {entry.outcome === "blockerResolved" ? (
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
                    {t("mission.timeline.outcomeResolved")}
                  </Badge>
                ) : entry.outcome === "stillBlocked" ? (
                  <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
                    {t("mission.timeline.outcomeStillBlocked")}
                  </Badge>
                ) : null}
              </>
            ) : (
              <>
                <span>
                  {entry.outcome === "accepted"
                    ? t("mission.timeline.recommendationAccepted")
                    : t("mission.timeline.recommendationDeclined")}
                </span>
                <span>·</span>
                <span>{relativeTime(entry.createdAt, now, locale, t("common.justNow"))}</span>
                {entry.outcome === "declined" && entry.note ? <span>— {entry.note}</span> : null}
              </>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
