import type { AxisModuleId } from "@/domain/axis";
import type { EntityResult } from "@/brain/entity/types";
import type { RoutingResult } from "@/brain/routing/types";
import type { ContextBundle } from "@/brain/context/types";
import { localized } from "@/i18n/message";
import type { LocalizedText } from "@/i18n/message";
import type { AutomationLevel, ExecutionPlan, ExecutionStep } from "./types";

interface DraftStep {
  description: LocalizedText;
  module: AxisModuleId;
}

function draftStepsForModule(
  module: AxisModuleId,
  entities: EntityResult,
): { steps: DraftStep[]; missingInfo: string[] } {
  switch (module) {
    case "task": {
      const steps: DraftStep[] = [
        { description: localized("planStep.createTask", { title: entities.title }), module: "task" },
      ];
      if (!entities.dueDate) {
        steps.push({ description: localized("planStep.askDueDate"), module: "task" });
        return { steps, missingInfo: ["dueDate"] };
      }
      return { steps, missingInfo: [] };
    }
    case "memory":
      return {
        steps: [{ description: localized("planStep.storeMemory", { title: entities.title }), module: "memory" }],
        missingInfo: [],
      };
    case "document":
      return {
        steps: [{ description: localized("planStep.saveDocument", { title: entities.title }), module: "document" }],
        missingInfo: [],
      };
    case "shopping":
      return {
        steps: [
          { description: localized("planStep.compareShoppingOptions", { title: entities.title }), module: "shopping" },
        ],
        missingInfo: [],
      };
    case "conversation":
      return {
        steps: [{ description: localized("planStep.answerQuestion"), module: "conversation" }],
        missingInfo: [],
      };
    default:
      return {
        steps: [{ description: localized("planStep.clarifyRequest"), module: "unknown" }],
        missingInfo: ["intent"],
      };
  }
}

function computeAutomationLevel(module: AxisModuleId, missingInfo: string[]): AutomationLevel {
  if (module === "unknown") return "manual";
  return missingInfo.length === 0 ? "automatic" : "assisted";
}

/**
 * Deterministic planner: turns a routing decision into an ordered list of
 * execution steps, flags missing information, and estimates how much of
 * the flow can run without user input.
 */
export function buildPlan(
  entities: EntityResult,
  routing: RoutingResult,
  context: ContextBundle,
): ExecutionPlan {
  const { steps: draftSteps, missingInfo } = draftStepsForModule(routing.chosenModule, entities);

  const allDraftSteps: DraftStep[] = context.atlasState
    ? draftSteps
    : [{ description: localized("planStep.initState"), module: routing.chosenModule }, ...draftSteps];

  const steps: ExecutionStep[] = allDraftSteps.map((step, index) => ({
    order: index + 1,
    description: step.description,
    module: step.module,
  }));

  return {
    steps,
    requiredModules: Array.from(new Set(steps.map((step) => step.module))),
    missingInfo,
    automationLevel: computeAutomationLevel(routing.chosenModule, missingInfo),
  };
}

export const planningEngine = { buildPlan };
