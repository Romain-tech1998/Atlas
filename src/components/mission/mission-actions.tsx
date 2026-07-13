"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { MissionStatusId } from "@/domain/mission";

interface MissionActionsProps {
  missionId: string;
  status: MissionStatusId;
}

type PendingAction = "COMPLETED" | "ABANDONED" | null;

/** Sprint-020 (RFC-0001 §4 "Mission Completion Semantics", scope 10): each
 * of the two terminal actions requires one explicit inline confirmation step
 * (no modal — none is used anywhere in this codebase, same as
 * `VerdictActions`'s decline panel, whose confirm/cancel/textarea shape this
 * reuses) with an optional note. Two clearly distinct actions, never one
 * ambiguous "End Mission." On a `409`, the mapped localized message is shown
 * and the panel stays open — no automatic retry. */
export function MissionActions({ missionId, status }: MissionActionsProps) {
  const router = useRouter();
  const t = useTranslations("mission.actions");
  const tCommon = useTranslations("common");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status !== "ACTIVE") return null;

  function mapError(code: string | undefined): string {
    if (code === "MISSION_ALREADY_TERMINAL") return t("alreadyTerminal");
    return tCommon("somethingWentWrong");
  }

  function openConfirm(action: Exclude<PendingAction, null>) {
    setPendingAction(action);
    setNote("");
    setError(null);
  }

  function cancel() {
    setPendingAction(null);
    setNote("");
    setError(null);
  }

  async function confirm() {
    if (!pendingAction || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const trimmedNote = note.trim();
      const response = await fetch(`/api/missions/${missionId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: pendingAction, ...(trimmedNote ? { note: trimmedNote } : {}) }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(mapError(body?.error));
      }
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : tCommon("somethingWentWrong"));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (pendingAction) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border p-4">
        <p className="text-sm font-medium">
          {pendingAction === "COMPLETED" ? t("confirmComplete") : t("confirmAbandon")}
        </p>
        <div className="flex flex-col gap-2">
          <Label htmlFor="mission-outcome-note" className="text-muted-foreground text-xs font-normal">
            {t("noteLabel")}
          </Label>
          <Textarea
            id="mission-outcome-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("notePlaceholder")}
            disabled={isSubmitting}
            className="min-h-16 text-sm"
          />
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={isSubmitting} onClick={confirm}>
            {isSubmitting ? t("submitting") : t("confirm")}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={isSubmitting} onClick={cancel}>
            {t("cancel")}
          </Button>
        </div>
        {error ? <p className="text-destructive text-xs">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <Button variant="outline" size="sm" onClick={() => openConfirm("COMPLETED")}>
        {t("markComplete")}
      </Button>
      <button
        type="button"
        onClick={() => openConfirm("ABANDONED")}
        className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
      >
        {t("abandon")}
      </button>
    </div>
  );
}
