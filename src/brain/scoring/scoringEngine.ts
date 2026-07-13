import type { IntentResult } from "@/brain/intent/types";
import type { EntityResult } from "@/brain/entity/types";
import type { RoutingResult } from "@/brain/routing/types";
import type { ExecutionPlan } from "@/brain/planning/types";
import type { ScoreBreakdown } from "./types";

const WEIGHTS = { intent: 0.3, entity: 0.2, routing: 0.3, plan: 0.2 };

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function scoreEntities(entities: EntityResult): number {
  const keywordBonus = Math.min(entities.keywords.length, 4) * 0.1;
  const dueDateBonus = entities.dueDate ? 0.2 : 0;
  return clamp(0.4 + keywordBonus + dueDateBonus);
}

function scorePlan(plan: ExecutionPlan): number {
  if (plan.missingInfo.length === 0) return 1;
  return clamp(1 - plan.missingInfo.length * 0.25, 0.25);
}

/**
 * Deterministic scoring: derives a confidence score for each pipeline
 * stage from that stage's own output, then combines them into an overall
 * weighted score.
 */
export function score(
  intent: IntentResult,
  entities: EntityResult,
  routing: RoutingResult,
  plan: ExecutionPlan,
): ScoreBreakdown {
  const intentScore = clamp(intent.confidence);
  const entityScore = scoreEntities(entities);
  const routingScore = clamp(routing.confidence);
  const planScore = scorePlan(plan);

  const overallScore =
    intentScore * WEIGHTS.intent +
    entityScore * WEIGHTS.entity +
    routingScore * WEIGHTS.routing +
    planScore * WEIGHTS.plan;

  return {
    intentScore: round(intentScore),
    entityScore: round(entityScore),
    routingScore: round(routingScore),
    planScore: round(planScore),
    overallScore: round(overallScore),
  };
}

export const scoringEngine = { score };
