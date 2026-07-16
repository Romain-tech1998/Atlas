import { axisParser } from "@/services/axisParser";
import { intentEngine } from "@/brain/intent/intentEngine";
import { entityEngine } from "@/brain/entity/entityEngine";
import { contextRepository } from "@/brain/context/contextRepository";
import { contextEngine } from "@/brain/context/contextEngine";
import { atlasStateEngine } from "@/brain/state/atlasStateEngine";
import { routingEngine } from "@/brain/routing/routingEngine";
import { planningEngine } from "@/brain/planning/planningEngine";
import { scoringEngine } from "@/brain/scoring/scoringEngine";
import { memoryEngine } from "@/brain/memory/memoryEngine";
import { learningEngine } from "@/brain/learning/learningEngine";
import { axisRequestRepository } from "@/services/axisRequestRepository";
import { computeDashboardStats, type DashboardStats } from "@/services/dashboardStats";
import { runSkill } from "@/skills/skillEngine";
import { createSaveDocumentSkill } from "@/skills/save-document";
import { createCreateTaskSkill } from "@/skills/create-task";
import { registerDefaultProviders } from "@/providers/registerDefaultProviders";
import { resolveDueDateKeyword } from "@/domain/due-date";
import type { PipelineTrace } from "@/brain/learning/types";
import type { AxisPipelineResult } from "@/brain/types";

/**
 * Atlas Brain: orchestrates the full Axis pipeline. Every stage is a pure
 * engine except for context lookup and the final save, which are the only
 * points that touch the database (via their own repositories).
 *
 * raw input -> axisParser -> intentEngine -> entityEngine -> contextEngine
 *   -> atlasStateEngine -> routingEngine -> planningEngine -> scoringEngine
 *   -> learningEngine -> save
 */
async function runPipeline(
  userId: string,
  rawInput: string,
  missionId?: string,
  decisionId?: string,
): Promise<AxisPipelineResult> {
  const normalizedInput = axisParser.normalize(rawInput);

  const intent = intentEngine.detectIntent(normalizedInput);
  const entities = entityEngine.extractEntities(normalizedInput, intent);

  const rawContext = await contextRepository.getContextData(userId);
  const context = contextEngine.buildContextBundle(rawContext, entities);

  const nextState = atlasStateEngine.computeNextState(context.atlasState, intent, entities);

  const routing = routingEngine.route(intent, entities, context);
  const plan = planningEngine.buildPlan(entities, routing, context);
  const score = scoringEngine.score(intent, entities, routing, plan);

  const memoryDraft = memoryEngine.buildMemoryDraft(intent, entities);

  const trace: PipelineTrace = { rawInput: normalizedInput, intent, entities, context, routing, plan, score };
  const learningSignals = learningEngine.buildSignals(trace);

  const summary = routingEngine.buildSummary(routing.chosenModule, entities);

  const result = await axisRequestRepository.saveAxisResult({
    userId,
    missionId,
    decisionId,
    rawInput: normalizedInput,
    summary,
    intent,
    entities,
    context,
    routing,
    plan,
    score,
    nextState,
    memoryDraft,
    learningSignals,
  });

  // RFC-0003 §9 `save_document` (Sprint-010) — the first Skill with
  // `sideEffects: "write"`. Gated exactly per RFC-0003 §6: a write Skill
  // only runs once the request's ExecutionPlan has already been scored at
  // a trusted automation level. `plan.automationLevel === "automatic"`
  // means `plan.missingInfo` is empty — a title was actually extracted,
  // nothing is ambiguous. A `document`-routed request that's merely
  // "assisted" creates nothing this sprint: an honest incomplete state,
  // never a silently-skipped or half-faked one. Runs after
  // `saveAxisResult` on purpose — `Document.axisRequestId` needs the saved
  // AxisRequest's real id, so the AxisRequest must exist first.
  if (routing.chosenModule === "document" && plan.automationLevel === "automatic") {
    // Sprint-035 (RFC-0003 §8h): `createDocument` resolves the Voyage
    // embedding Provider by id via the registry — unlike the API routes
    // that call a Provider-backed Skill directly (each already calls this
    // before running its Skill), nothing upstream of this pipeline ever
    // populates the registry, so it must happen here too, or the registry
    // is simply empty and the embedding silently never gets generated on
    // this path. Idempotent (`registerProvider` overwrites by id), so safe
    // to call on every pipeline run.
    registerDefaultProviders();
    const saveDocumentSkill = createSaveDocumentSkill(userId, result.id);
    await runSkill(saveDocumentSkill, { title: entities.title, content: normalizedInput });
  }

  // RFC-0003 §9 `create_task` (Sprint-025) — same gate as `save_document`
  // above: only runs once `plan.automationLevel === "automatic"`, which for
  // the `task` module (planningEngine.ts) means `entities.dueDate` was
  // actually extracted, so `resolveDueDateKeyword` below is never called
  // with an undefined keyword on this path in practice. `new Date()` here is
  // the orchestration boundary reading wall-clock time, same as Prisma's own
  // `createdAt` defaults elsewhere — the pure engines upstream never touch
  // the clock themselves.
  if (routing.chosenModule === "task" && plan.automationLevel === "automatic") {
    const dueDate = resolveDueDateKeyword(entities.dueDate, new Date());
    const createTaskSkill = createCreateTaskSkill(userId, result.id);
    await runSkill(createTaskSkill, { title: entities.title, dueDate });
  }

  return result;
}

async function getRecentRequests(userId: string, take = 10): Promise<AxisPipelineResult[]> {
  return axisRequestRepository.getRecentRequests(userId, take);
}

async function getDashboardStats(userId: string): Promise<DashboardStats> {
  const raw = await axisRequestRepository.getDashboardRawData(userId);
  return computeDashboardStats(raw);
}

export const atlasBrain = { runPipeline, getRecentRequests, getDashboardStats };
