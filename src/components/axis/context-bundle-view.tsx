"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { renderLocalized } from "@/i18n/render";
import type { ContextBundle } from "@/brain/context/types";

interface ContextBundleViewProps {
  context: ContextBundle;
}

export function ContextBundleView({ context }: ContextBundleViewProps) {
  const tRoot = useTranslations();
  const t = useTranslations("axis.context");
  const hasAnyContext =
    context.relevantMemories.length > 0 || context.recentMissions.length > 0 || context.openTasks.length > 0;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground">
        {t("used")}
        {context.atlasState ? null : <span className="italic"> {t("firstInteraction")}</span>}
      </p>

      {!hasAnyContext ? (
        <p className="text-muted-foreground text-xs italic">{t("nothingRelevant")}</p>
      ) : (
        <div className="flex flex-col gap-2 text-xs">
          {context.relevantMemories.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-muted-foreground">{t("memories")}</span>
              {context.relevantMemories.slice(0, 4).map((memory) => (
                <Badge key={memory.id} variant="outline">
                  {memory.content} ({Math.round(memory.relevance * 100)}%)
                </Badge>
              ))}
            </div>
          ) : null}

          {context.openTasks.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-muted-foreground">{t("openTasks")}</span>
              {context.openTasks.slice(0, 4).map((task) => (
                <Badge key={task.id} variant="outline">
                  {task.title}
                </Badge>
              ))}
            </div>
          ) : null}

          {context.recentMissions.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-muted-foreground">{t("missions")}</span>
              {context.recentMissions.slice(0, 3).map((mission) => (
                <Badge key={mission.id} variant="outline">
                  {mission.title ? renderLocalized(tRoot, mission.title) : t("untitled")}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
