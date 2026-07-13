"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AxisInput } from "@/components/axis/axis-input";
import { AtlasWorkingIndicator } from "@/components/mission/atlas-working-indicator";

interface MissionUpdateInputProps {
  missionId: string;
  heading?: string;
  placeholder: string;
  submitLabel: string;
}

export function MissionUpdateInput({ missionId, heading, placeholder, submitLabel }: MissionUpdateInputProps) {
  const router = useRouter();
  const t = useTranslations();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(rawInput: string) {
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/missions/${missionId}/updates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawInput }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        // Sprint-020 (correction 8): only this sprint's new machine-readable
        // code gets mapped to localized copy — every other error here
        // predates this sprint and keeps sending its raw `error.message`
        // unchanged, exactly as it did before.
        if (body?.error === "MISSION_NOT_ACTIVE") {
          throw new Error(t("mission.updateInput.missionNotActive"));
        }
        throw new Error(body?.error ?? t("mission.updateInput.updateFailed"));
      }
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("common.somethingWentWrong"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {heading ? <h2 className="text-sm font-medium">{heading}</h2> : null}
      <AxisInput
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        placeholder={placeholder}
        submitLabel={submitLabel}
        submittingLabel={t("mission.updateInput.submitting")}
        rows={2}
      />
      {isSubmitting ? <AtlasWorkingIndicator label={t("mission.updateInput.workingLabel")} /> : null}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
