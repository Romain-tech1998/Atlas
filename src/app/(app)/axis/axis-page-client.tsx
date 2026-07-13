"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AxisInput } from "@/components/axis/axis-input";
import { AxisResultCard } from "@/components/axis/axis-result-card";
import type { AxisPipelineResult } from "@/brain/types";

interface AxisPageClientProps {
  initialResults: AxisPipelineResult[];
}

export function AxisPageClient({ initialResults }: AxisPageClientProps) {
  const t = useTranslations("axis");
  const tCommon = useTranslations("common");
  const [results, setResults] = useState<AxisPipelineResult[]>(initialResults);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(rawInput: string) {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/axis/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawInput }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? t("parseFailed"));
      }

      const result = (await response.json()) as AxisPipelineResult;
      setResults((current) => [result, ...current]);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : tCommon("somethingWentWrong"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <AxisInput
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        placeholder={t("input.placeholder")}
        submitLabel={t("input.submit")}
        submittingLabel={t("input.submitting")}
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-col gap-4">
        {results.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noResults")}</p>
        ) : (
          results.map((result) => <AxisResultCard key={result.id} result={result} />)
        )}
      </div>
    </div>
  );
}
