"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { ModuleBadge } from "@/components/module/module-badge";
import { renderLocalized } from "@/i18n/render";
import { automationLabel } from "@/i18n/automation-label";
import type { ExecutionPlan } from "@/brain/planning/types";

interface ExecutionPlanViewProps {
  plan: ExecutionPlan;
}

export function ExecutionPlanView({ plan }: ExecutionPlanViewProps) {
  const t = useTranslations();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground">{t("axis.plan.title")}</p>
        <Badge variant="secondary">{automationLabel(t, plan.automationLevel)}</Badge>
      </div>

      <ol className="flex flex-col gap-1 text-xs">
        {plan.steps.map((step) => (
          <li key={step.order} className="flex gap-2">
            <span className="text-muted-foreground">{step.order}.</span>
            <span>{renderLocalized(t, step.description)}</span>
            <span className="ml-auto">
              <ModuleBadge module={step.module} t={t} />
            </span>
          </li>
        ))}
      </ol>

      {plan.missingInfo.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("axis.plan.missing", { fields: plan.missingInfo.join(", ") })}
        </p>
      ) : null}
    </div>
  );
}
