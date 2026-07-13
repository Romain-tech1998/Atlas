"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { renderLocalized } from "@/i18n/render";
import type { LocalizedText } from "@/i18n/message";

interface VerdictActionsProps {
  decisionId: string;
  recommendation: LocalizedText;
}

/**
 * RFC-0001 §4 "Verdict Acceptance" (Sprint-017): rendered as `MissionHero`'s
 * `actionSlot` only while a Verdict is `PRODUCED` and its Decision isn't yet
 * `RESOLVED` (see the Mission page's precedence logic). Same
 * `isSubmitting`/error-display discipline as `EvidenceForm` — reusing the
 * look, not inventing a new one. Accepting never sends a note; declining
 * requires one, never attaches it as Evidence, and never re-runs anything —
 * the Verdict itself is untouched either way.
 */
export function VerdictActions({ decisionId, recommendation }: VerdictActionsProps) {
  const router = useRouter();
  const t = useTranslations("mission.verdictActions");
  const tRoot = useTranslations();
  const [showDecline, setShowDecline] = useState(false);
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve(outcome: "accepted" | "declined", noteValue?: string): Promise<boolean> {
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/decisions/${decisionId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(noteValue !== undefined ? { outcome, note: noteValue } : { outcome }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? t("error"));
      }
      router.refresh();
      return true;
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("error"));
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAccept() {
    if (isSubmitting) return;
    await resolve("accepted");
  }

  async function handleConfirmDecline() {
    if (isSubmitting || note.trim().length === 0) return;
    if (await resolve("declined", note.trim())) {
      setShowDecline(false);
      setNote("");
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <p className="text-sm">{renderLocalized(tRoot, recommendation)}</p>

      {!showDecline ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={isSubmitting} onClick={handleAccept}>
            {isSubmitting ? t("submitting") : t("accept")}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={isSubmitting} onClick={() => setShowDecline(true)}>
            {t("declineToggle")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Label htmlFor="verdict-decline-note" className="text-muted-foreground text-xs font-normal">
            {t("notePrompt")}
          </Label>
          <Textarea
            id="verdict-decline-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("notePlaceholder")}
            disabled={isSubmitting}
            className="min-h-16 text-sm"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={isSubmitting || note.trim().length === 0}
              onClick={handleConfirmDecline}
            >
              {isSubmitting ? t("submitting") : t("confirm")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isSubmitting}
              onClick={() => {
                setShowDecline(false);
                setNote("");
              }}
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}

      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
