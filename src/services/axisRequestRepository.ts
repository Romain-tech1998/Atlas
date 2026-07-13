import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { atlasStateRepository } from "@/brain/state/atlasStateRepository";
import { memoryRepository } from "@/brain/memory/memoryRepository";
import { learningRepository } from "@/brain/learning/learningRepository";
import type { AtlasStateSnapshot } from "@/brain/state/types";
import type { IntentResult } from "@/brain/intent/types";
import type { EntityResult } from "@/brain/entity/types";
import type { ContextBundle } from "@/brain/context/types";
import type { RoutingResult } from "@/brain/routing/types";
import type { ExecutionPlan } from "@/brain/planning/types";
import type { ScoreBreakdown } from "@/brain/scoring/types";
import type { MemoryDraft } from "@/brain/memory/types";
import type { LearningSignalDraft } from "@/brain/learning/types";
import type { AxisPipelineResult, LearningSignalView } from "@/brain/types";
import { localized, type LocalizedText } from "@/i18n/message";
import { rawLocalizedText } from "@/i18n/render";
import { decodePersistedText, encodePersistedText } from "@/i18n/persisted-text";

export interface SaveAxisResultInput {
  userId: string;
  missionId?: string;
  decisionId?: string;
  rawInput: string;
  summary: LocalizedText;
  intent: IntentResult;
  entities: EntityResult;
  context: ContextBundle;
  routing: RoutingResult;
  plan: ExecutionPlan;
  score: ScoreBreakdown;
  nextState: AtlasStateSnapshot;
  memoryDraft: MemoryDraft | null;
  learningSignals: LearningSignalDraft[];
}

const RECENT_REQUEST_INCLUDE = {
  decisions: true,
  learningSignals: { orderBy: { createdAt: "asc" as const } },
};

type AxisRequestWithRelations = Prisma.AxisRequestGetPayload<{ include: typeof RECENT_REQUEST_INCLUDE }>;

function toLearningSignalViews(
  signals: AxisRequestWithRelations["learningSignals"],
): LearningSignalView[] {
  return signals.map((signal) => ({
    id: signal.id,
    type: signal.signalType.toLowerCase() as LearningSignalView["type"],
    payload: (signal.payload as Record<string, unknown>) ?? {},
    createdAt: signal.createdAt.toISOString(),
  }));
}

/** Reads a stored contextSnapshot defensively: Json columns don't enforce
 * shape at the DB level. Older rows (pre-Mission rename) stored the
 * mission list under `recentConversations` instead of `recentMissions`,
 * and pre-i18n rows hold each mission's `title` as a plain string rather
 * than a `LocalizedText` key+params — both are normalized here. */
function normalizeContext(raw: unknown): ContextBundle {
  const obj = (raw ?? {}) as Partial<ContextBundle> & { recentConversations?: unknown };
  const rawMissions = Array.isArray(obj.recentMissions)
    ? obj.recentMissions
    : Array.isArray(obj.recentConversations)
      ? (obj.recentConversations as ContextBundle["recentMissions"])
      : [];

  return {
    relevantMemories: Array.isArray(obj.relevantMemories) ? obj.relevantMemories : [],
    recentMissions: rawMissions.map((mission) => ({
      ...mission,
      title: typeof mission.title === "string" ? rawLocalizedText(mission.title) : mission.title,
    })),
    openTasks: Array.isArray(obj.openTasks) ? obj.openTasks : [],
    atlasState: obj.atlasState ?? null,
  };
}

const EMPTY_PLAN: ExecutionPlan = { steps: [], requiredModules: [], missingInfo: [], automationLevel: "manual" };

/** Reads a stored executionPlan defensively: older rows (pre-i18n) hold
 * `steps[].description` as a plain string instead of a `LocalizedText`
 * key+params — reading `.key` off a string crashes, so those are wrapped
 * as raw passthrough text instead. */
function normalizePlan(raw: unknown): ExecutionPlan {
  if (!raw || typeof raw !== "object") return EMPTY_PLAN;
  const obj = raw as Partial<ExecutionPlan>;

  const steps = Array.isArray(obj.steps)
    ? obj.steps.map((step) => ({
        ...step,
        description:
          typeof step.description === "string" ? rawLocalizedText(step.description) : step.description,
      }))
    : [];

  return {
    steps,
    requiredModules: Array.isArray(obj.requiredModules) ? obj.requiredModules : [],
    missingInfo: Array.isArray(obj.missingInfo) ? obj.missingInfo : [],
    automationLevel: obj.automationLevel ?? "manual",
  };
}

function rowToPipelineResult(row: AxisRequestWithRelations): AxisPipelineResult {
  const [decision] = row.decisions;

  return {
    id: row.id,
    rawInput: row.rawInput,
    status: row.status,
    summary: decodePersistedText(row.summary) ?? rawLocalizedText(row.rawInput),
    createdAt: row.createdAt.toISOString(),
    intent: {
      intent: (row.intent as IntentResult["intent"]) ?? "unknown",
      module: (row.module as IntentResult["module"]) ?? "unknown",
      confidence: row.confidence ?? 0,
      triggerMatch: null,
    },
    entities: (row.entities as unknown as EntityResult) ?? { title: row.rawInput, keywords: [] },
    context: normalizeContext(row.contextSnapshot),
    routing: decision
      ? {
          chosenModule: decision.chosenModule as RoutingResult["chosenModule"],
          suggestedModules: decision.suggestedModules as RoutingResult["suggestedModules"],
          action: decision.action,
          reasoning: decodePersistedText(decision.reasoning) ?? localized("routing.noDecisionRecorded"),
          confidence: decision.confidence,
        }
      : {
          chosenModule: "unknown",
          suggestedModules: ["unknown"],
          action: "request_clarification",
          reasoning: localized("routing.noDecisionRecorded"),
          confidence: 0,
        },
    plan: normalizePlan(row.executionPlan),
    score: (row.scoreBreakdown as unknown as ScoreBreakdown) ?? {
      intentScore: 0,
      entityScore: 0,
      routingScore: 0,
      planScore: 0,
      overallScore: 0,
    },
    learningSignals: toLearningSignalViews(row.learningSignals),
  };
}

/** Persists the full pipeline output atomically: the AxisRequest itself,
 * its routing decision, the updated Atlas State, any new memory, and the
 * learning signals derived from this run. */
async function saveAxisResult(input: SaveAxisResultInput): Promise<AxisPipelineResult> {
  return prisma.$transaction(async (tx) => {
    const axisRequest = await tx.axisRequest.create({
      data: {
        userId: input.userId,
        missionId: input.missionId,
        decisionId: input.decisionId,
        rawInput: input.rawInput,
        status: "PARSED",
        intent: input.intent.intent,
        module: input.intent.module,
        confidence: input.routing.confidence,
        entities: input.entities as unknown as Prisma.InputJsonValue,
        summary: encodePersistedText(input.summary),
        contextSnapshot: input.context as unknown as Prisma.InputJsonValue,
        executionPlan: input.plan as unknown as Prisma.InputJsonValue,
        scoreBreakdown: input.score as unknown as Prisma.InputJsonValue,
      },
    });

    const decision = await tx.axisDecision.create({
      data: {
        axisRequestId: axisRequest.id,
        chosenModule: input.routing.chosenModule,
        suggestedModules: input.routing.suggestedModules,
        action: input.routing.action,
        reasoning: encodePersistedText(input.routing.reasoning),
        confidence: input.routing.confidence,
      },
    });

    await atlasStateRepository.upsertState(input.userId, input.nextState, tx);

    if (input.memoryDraft) {
      await memoryRepository.saveMemory(input.userId, input.memoryDraft, tx);
    }

    await learningRepository.saveSignals(input.userId, axisRequest.id, input.learningSignals, tx);

    const learningSignalRows = await tx.learningSignal.findMany({
      where: { axisRequestId: axisRequest.id },
      orderBy: { createdAt: "asc" },
    });

    return rowToPipelineResult({ ...axisRequest, decisions: [decision], learningSignals: learningSignalRows });
  });
}

async function getRecentRequests(userId: string, take = 10): Promise<AxisPipelineResult[]> {
  const rows = await prisma.axisRequest.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
    include: RECENT_REQUEST_INCLUDE,
  });

  return rows.map(rowToPipelineResult);
}

/** Backfill helper: re-parents every AxisRequest under a Mission that
 * predates Decision (has no decisionId yet) onto the given Decision. See
 * `decisionService.ensureDecisionForMission`. */
async function attachOrphanedRequestsToDecision(userId: string, missionId: string, decisionId: string): Promise<void> {
  await prisma.axisRequest.updateMany({
    where: { userId, missionId, decisionId: null },
    data: { decisionId },
  });
}

/** All AxisRequests made toward a single Decision, oldest first (for
 * timeline storytelling), ownership-checked via userId. */
async function getRequestsForDecision(userId: string, decisionId: string): Promise<AxisPipelineResult[]> {
  const rows = await prisma.axisRequest.findMany({
    where: { userId, decisionId },
    orderBy: { createdAt: "asc" },
    include: RECENT_REQUEST_INCLUDE,
  });

  return rows.map(rowToPipelineResult);
}

/** Same as getRequestsForDecision, batched across several decisions at once
 * to avoid an N+1 query when listing missions. Returns oldest-first per
 * decision, keyed by decisionId. */
async function getRequestsForDecisions(
  userId: string,
  decisionIds: string[],
): Promise<Map<string, AxisPipelineResult[]>> {
  if (decisionIds.length === 0) return new Map();

  const rows = await prisma.axisRequest.findMany({
    where: { userId, decisionId: { in: decisionIds } },
    orderBy: { createdAt: "asc" },
    include: RECENT_REQUEST_INCLUDE,
  });

  const byDecision = new Map<string, AxisPipelineResult[]>();
  for (const row of rows) {
    const result = rowToPipelineResult(row);
    const decisionId = row.decisionId;
    if (!decisionId) continue;
    const existing = byDecision.get(decisionId);
    if (existing) {
      existing.push(result);
    } else {
      byDecision.set(decisionId, [result]);
    }
  }
  return byDecision;
}

export interface DashboardRawData {
  totalRequests: number;
  averageConfidence: number | null;
  activeDomains: Record<string, number>;
  suggestedModuleLists: string[][];
  latestPlans: Array<{ id: string; summary: LocalizedText; executionPlan: unknown; createdAt: Date }>;
}

const LATEST_PLANS_LIMIT = 5;

async function getDashboardRawData(userId: string): Promise<DashboardRawData> {
  const [aggregate, decisions, latestPlans, atlasState] = await Promise.all([
    prisma.axisRequest.aggregate({
      where: { userId },
      _count: true,
      _avg: { confidence: true },
    }),
    prisma.axisDecision.findMany({
      where: { axisRequest: { userId } },
      select: { suggestedModules: true },
    }),
    prisma.axisRequest.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: LATEST_PLANS_LIMIT,
      select: { id: true, summary: true, executionPlan: true, createdAt: true },
    }),
    atlasStateRepository.getState(userId),
  ]);

  return {
    totalRequests: aggregate._count,
    averageConfidence: aggregate._avg.confidence,
    activeDomains: atlasState?.activeDomains ?? {},
    suggestedModuleLists: decisions.map((decision) => decision.suggestedModules),
    latestPlans: latestPlans.map((plan) => ({
      ...plan,
      summary: decodePersistedText(plan.summary) ?? rawLocalizedText(""),
    })),
  };
}

export const axisRequestRepository = {
  saveAxisResult,
  getRecentRequests,
  attachOrphanedRequestsToDecision,
  getRequestsForDecision,
  getRequestsForDecisions,
  getDashboardRawData,
};
