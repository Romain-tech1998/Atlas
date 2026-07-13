"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { renderLocalized } from "@/i18n/render";
import { decisionJourneyStatusLabel } from "@/i18n/decision-journey-status-label";
import type { DecisionSummary } from "@/domain/decision";

interface DecisionCardProps {
  decision: DecisionSummary;
  /** RFC-0001 §4 "Mission Journey" (Sprint-019, correction 6): only the
   * Decision with the highest `number` starts expanded — computed by the
   * page (which knows every sibling's `number`), passed down as a plain
   * boolean. Client-side `useState` only from here on; never persisted. */
  defaultExpanded: boolean;
  /** A pre-rendered `<MissionTimeline entries={decision.timeline} />` from
   * the page — this card never imports or calls `MissionTimeline` itself
   * (it's an async Server Component; a "use client" module can receive it
   * as a prop but not invoke it directly). Reused with zero logic changes:
   * its own "hide the trailing `update` entry" rule already produces the
   * right result per section (a resolved section trails with a `kind:
   * "resolution"` entry, which is never hidden; the active section's
   * trailing `update` stays hidden because Current Focus already shows it). */
  timelineSlot: React.ReactNode;
  /** A pre-rendered `<DecisionEvidence /.../><VerdictActions /.../>` pair
   * from the page, using the Evidence/Verdict data already fetched once for
   * `mission.activeDecision` — only ever passed (and only ever rendered)
   * when `decision.isActive`. This card never fetches Evidence itself. */
  activeSlot?: React.ReactNode;
}

/**
 * RFC-0001 §4 "Mission Journey" (Sprint-019): one section per Decision in
 * `mission.decisions[]`. Computes nothing — every value it renders
 * (`number`, `journeyStatus`, `isActive`, `recommendation`, `timeline`)
 * arrives precomputed from `missionService.buildMissionSummary`. The
 * compact resolved-Decision summary (recommendation + accepted/declined +
 * note) is read directly from already-resolved fields — `recommendation`
 * from the Decision's own field (correction 3), the accept/decline outcome
 * and note from `timeline`'s trailing `kind: "resolution"` entry
 * (correction 1) — never recomputed, never fabricated when absent (a
 * Decision resolved through a pre-Sprint-017 path simply has no such
 * entry, and this renders nothing extra for it — an "archived" section
 * shows header + Timeline only, by the same "show only what exists" rule).
 */
export function DecisionCard({ decision, defaultExpanded, timelineSlot, activeSlot }: DecisionCardProps) {
  const t = useTranslations("mission.journey");
  const tRoot = useTranslations();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const trailingEntry = decision.timeline[decision.timeline.length - 1];
  const resolution = trailingEntry?.kind === "resolution" ? trailingEntry : null;

  return (
    <section id={`decision-${decision.number}`} className="flex flex-col gap-3 rounded-2xl border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs font-medium">
            {t("decisionNumber", { number: decision.number })}
          </span>
          <span className="text-sm font-medium">{renderLocalized(tRoot, decision.title)}</span>
          <Badge variant="outline">{decisionJourneyStatusLabel(tRoot, decision.journeyStatus)}</Badge>
        </div>
        <Button type="button" variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setExpanded((prev) => !prev)}>
          {expanded ? t("collapse") : t("expand")}
        </Button>
      </div>

      {decision.journeyStatus === "resolved" ? (
        <div className="flex flex-col gap-1 text-sm">
          {decision.recommendation ? <p>{renderLocalized(tRoot, decision.recommendation)}</p> : null}
          {resolution ? (
            <p className="text-muted-foreground text-xs">
              {resolution.outcome === "accepted"
                ? tRoot("mission.timeline.recommendationAccepted")
                : tRoot("mission.timeline.recommendationDeclined")}
              {resolution.outcome === "declined" && resolution.note ? ` — ${resolution.note}` : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {expanded ? (
        <div className="flex flex-col gap-4">
          {timelineSlot}
          {decision.isActive ? activeSlot : null}
        </div>
      ) : null}
    </section>
  );
}
