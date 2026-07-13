"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ContextBundleView } from "./context-bundle-view";
import { ExecutionPlanView } from "./execution-plan-view";
import { ScoreBreakdownView } from "./score-breakdown-view";
import { LearningSignalsView } from "./learning-signals-view";
import { renderLocalized } from "@/i18n/render";
import { moduleLabel } from "@/i18n/module-label";
import type { AxisPipelineResult } from "@/brain/types";

interface AxisResultCardProps {
  result: AxisPipelineResult;
}

export function AxisResultCard({ result }: AxisResultCardProps) {
  const t = useTranslations();
  const chosenModuleLabel = moduleLabel(t, result.routing.chosenModule);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{renderLocalized(t, result.summary)}</CardTitle>
          <div className="flex gap-1">
            {result.routing.suggestedModules.map((module) => (
              <Badge key={module} variant={module === result.routing.chosenModule ? "default" : "outline"}>
                {moduleLabel(t, module)}
              </Badge>
            ))}
          </div>
        </div>
        <CardDescription>&ldquo;{result.rawInput}&rdquo;</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div>
            <p className="text-muted-foreground">{t("axis.resultCard.intent")}</p>
            <p className="font-medium">{result.intent.intent}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("axis.resultCard.status")}</p>
            <p className="font-medium">{result.status}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("axis.resultCard.module")}</p>
            <p className="font-medium">{chosenModuleLabel}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("axis.resultCard.due")}</p>
            <p className="font-medium">{result.entities.dueDate ?? "—"}</p>
          </div>
        </div>

        {result.entities.keywords.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {result.entities.keywords.map((keyword) => (
              <Badge key={keyword} variant="outline">
                {keyword}
              </Badge>
            ))}
          </div>
        ) : null}

        <Separator />
        <ContextBundleView context={result.context} />

        <Separator />
        <ExecutionPlanView plan={result.plan} />

        <Separator />
        <ScoreBreakdownView score={result.score} />

        <Separator />
        <div>
          <p className="text-muted-foreground">{t("axis.resultCard.atlasDecision")}</p>
          <p className="font-medium">
            {result.routing.action} ({Math.round(result.routing.confidence * 100)}%)
          </p>
          <p className="text-muted-foreground">{renderLocalized(t, result.routing.reasoning)}</p>
        </div>

        <LearningSignalsView signals={result.learningSignals} />
      </CardContent>
    </Card>
  );
}
