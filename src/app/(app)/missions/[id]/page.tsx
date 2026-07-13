import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { missionService } from "@/services/missionService";
import { opportunityService } from "@/services/opportunityService";
import { evidenceService } from "@/services/evidenceService";
import { MissionHero } from "@/components/mission/mission-hero";
import { MissionTimeline } from "@/components/mission/mission-timeline";
import { MissionActions } from "@/components/mission/mission-actions";
import { OpportunityList } from "@/components/mission/opportunity-list";
import { DecisionEvidence } from "@/components/mission/decision-evidence";
import { VerdictActions } from "@/components/mission/verdict-actions";
import { DecisionCard } from "@/components/mission/decision-card";
import { MissionUpdateInput } from "./mission-update-input";

export default async function MissionPage(props: PageProps<"/missions/[id]">) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const { id: missionId } = await props.params;
  const [mission, allMissions] = await Promise.all([
    missionService.getMissionSummary(session.user.id, missionId),
    missionService.listMissionSummaries(session.user.id),
  ]);
  if (!mission) {
    notFound();
  }

  // Sprint-018: there is nothing to gather Evidence for or produce a
  // Verdict on when the Mission has no currently open Decision.
  const activeDecision = mission.activeDecision;
  const [evidenceAndVerdict, initialMemories, initialDocuments] = await Promise.all([
    activeDecision ? evidenceService.getEvidenceAndVerdict(session.user.id, activeDecision.id) : null,
    evidenceService.listMemoriesForEvidence(session.user.id),
    evidenceService.listDocumentsForEvidence(session.user.id),
  ]);

  const t = await getTranslations();
  // Sprint-018: still means "this is the Mission's founding request" even
  // though `timeline` is now Mission-scoped — once a second Decision starts,
  // the aggregated array already holds the first Decision's full history
  // plus its resolution entry, so this is never true again after Decision 1,
  // which is exactly the intended "picking up where you left off" copy.
  const isFirstUpdate = mission.timeline.length <= 1;
  const opportunities = opportunityService.deriveOpportunities(allMissions, mission.id);
  const isActive = mission.status === "ACTIVE";

  // RFC-0001 §4 "Mission Journey" (Sprint-019, correction 8): plain counts
  // from already-fetched data — no Prisma fields, no percentage, no
  // progress bar. `activeCount` is always 0 or 1 by the sequential
  // invariant (Sprint-018) — stated plainly, not hedged.
  const completedCount = mission.decisions.filter((decision) => decision.journeyStatus !== "active").length;
  const activeCount = mission.decisions.filter((decision) => decision.isActive).length;

  // RFC-0001 §4 "Mission Journey" (Sprint-019, correction 10): the active
  // Decision's Evidence/Verdict UI, pre-rendered once here using the data
  // already fetched above — passed into whichever DecisionCard is active,
  // never fetched again inside it. This also replaces Sprint-017's
  // Hero-level VerdictActions slot: accept/decline now lives inside the
  // Mission Journey's active section, alongside Evidence, rather than
  // competing with Current Focus at the top of the page.
  const activeSlot =
    activeDecision && evidenceAndVerdict ? (
      <>
        <DecisionEvidence
          decisionId={activeDecision.id}
          evidence={evidenceAndVerdict.evidence}
          verdict={evidenceAndVerdict.verdict}
          initialMemories={initialMemories}
          initialDocuments={initialDocuments}
        />
        {evidenceAndVerdict.verdict.status === "PRODUCED" && evidenceAndVerdict.verdict.recommendation ? (
          <VerdictActions decisionId={activeDecision.id} recommendation={evidenceAndVerdict.verdict.recommendation} />
        ) : null}
      </>
    ) : undefined;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-10 p-6">
      <MissionHero
        mission={mission}
        isFirstUpdate={isFirstUpdate}
        actionSlot={
          isActive && mission.currentFocus.blocked ? (
            <MissionUpdateInput
              missionId={mission.id}
              placeholder={t("mission.updateInput.answerPlaceholder")}
              submitLabel={t("mission.updateInput.answerSubmit")}
            />
          ) : undefined
        }
      />

      {isActive && !mission.currentFocus.blocked ? (
        <MissionUpdateInput
          missionId={mission.id}
          heading={t("mission.updateInput.heading")}
          placeholder={t("mission.updateInput.placeholder")}
          submitLabel={t("mission.updateInput.submit")}
        />
      ) : null}

      <OpportunityList opportunities={opportunities} title={t("opportunity.whileYoureHere")} />

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            {t("mission.journey.title")}
          </h2>
          <span className="text-muted-foreground text-xs">
            {t("mission.journey.progress", { completed: completedCount, active: activeCount })}
          </span>
        </div>
        {mission.decisions.map((decision) => (
          <DecisionCard
            key={decision.id}
            decision={decision}
            defaultExpanded={decision.number === mission.decisions.length}
            timelineSlot={<MissionTimeline entries={decision.timeline} />}
            activeSlot={decision.isActive ? activeSlot : undefined}
          />
        ))}
        {/* Sprint-020 (RFC-0001 §4 "Mission Completion Semantics", correction
         * 1): a Mission-level fact, rendered as its own element outside
         * every `DecisionCard` — never nested inside one. */}
        {mission.outcomeEntry ? (
          <p className="text-muted-foreground text-xs">
            {mission.outcomeEntry.outcome === "completed"
              ? t("mission.outcome.entryCompleted")
              : t("mission.outcome.entryAbandoned")}
            {mission.outcomeEntry.note ? ` — ${mission.outcomeEntry.note}` : ""}
          </p>
        ) : null}
      </div>

      <MissionActions missionId={mission.id} status={mission.status} />
    </main>
  );
}
