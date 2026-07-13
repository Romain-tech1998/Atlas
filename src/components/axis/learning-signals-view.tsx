"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { LearningSignalView } from "@/brain/types";

interface LearningSignalsViewProps {
  signals: LearningSignalView[];
}

export function LearningSignalsView({ signals }: LearningSignalsViewProps) {
  const t = useTranslations("axis");
  if (signals.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground">{t("learningSignals")}</p>
      <div className="flex flex-wrap gap-1">
        {signals.map((signal) => (
          <Badge key={signal.id} variant="secondary">
            {signal.type.replaceAll("_", " ")}
          </Badge>
        ))}
      </div>
    </div>
  );
}
