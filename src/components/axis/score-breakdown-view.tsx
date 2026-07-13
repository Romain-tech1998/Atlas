"use client";

import { useTranslations } from "next-intl";
import type { ScoreBreakdown } from "@/brain/scoring/types";

interface ScoreBreakdownViewProps {
  score: ScoreBreakdown;
}

function formatScore(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function ScoreBreakdownView({ score }: ScoreBreakdownViewProps) {
  const t = useTranslations("axis.score");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground">{t("title")}</p>
        <span className="font-semibold">{formatScore(score.overallScore)}</span>
      </div>
      <div className="grid grid-cols-4 gap-2 text-xs">
        <div>
          <p className="text-muted-foreground">{t("intent")}</p>
          <p className="font-medium">{formatScore(score.intentScore)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">{t("entities")}</p>
          <p className="font-medium">{formatScore(score.entityScore)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">{t("routing")}</p>
          <p className="font-medium">{formatScore(score.routingScore)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">{t("plan")}</p>
          <p className="font-medium">{formatScore(score.planScore)}</p>
        </div>
      </div>
    </div>
  );
}
