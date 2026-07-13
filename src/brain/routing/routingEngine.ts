import type { AxisModuleId } from "@/domain/axis";
import type { IntentResult } from "@/brain/intent/types";
import type { EntityResult } from "@/brain/entity/types";
import type { ContextBundle } from "@/brain/context/types";
import { localized, type LocalizedText } from "@/i18n/message";
import type { RoutingResult } from "./types";

const LOW_CONFIDENCE_THRESHOLD = 0.6;
const FALLBACK_MODULES: AxisModuleId[] = ["conversation", "unknown"];

function describeAction(intent: IntentResult, entities: EntityResult): { action: string; reasoning: LocalizedText } {
  switch (intent.module) {
    case "task":
      return {
        action: "create_task_draft",
        reasoning: localized("routingReasoning.task", {
          hasDueDate: entities.dueDate ? "yes" : "no",
          dueDate: entities.dueDate ?? "",
        }),
      };
    case "memory":
      return { action: "store_fact", reasoning: localized("routingReasoning.memory") };
    case "document":
      return { action: "create_document_draft", reasoning: localized("routingReasoning.document") };
    case "shopping":
      return { action: "compare_shopping_options", reasoning: localized("routingReasoning.shopping") };
    case "conversation":
      return { action: "answer_question", reasoning: localized("routingReasoning.conversation") };
    default:
      return { action: "request_clarification", reasoning: localized("routingReasoning.unknown") };
  }
}

function suggestModules(chosenModule: AxisModuleId, confidence: number): AxisModuleId[] {
  if (confidence >= LOW_CONFIDENCE_THRESHOLD) return [chosenModule];

  return Array.from(new Set([chosenModule, ...FALLBACK_MODULES]));
}

/**
 * Deterministic routing: given the parsed intent, extracted entities, and
 * assembled context, decides which module should own the request (and
 * which other modules are plausible fallbacks when confidence is low).
 */
export function route(intent: IntentResult, entities: EntityResult, context: ContextBundle): RoutingResult {
  const { action, reasoning } = describeAction(intent, entities);

  // Context-aware confidence nudge: a duplicate-looking open task for this
  // exact title lowers confidence slightly, since it may be a repeat rather
  // than a fresh request.
  const isLikelyDuplicateTask =
    intent.module === "task" &&
    context.openTasks.some((task) => task.title.toLowerCase() === entities.title.toLowerCase());
  const confidence = isLikelyDuplicateTask ? Math.max(0.5, intent.confidence - 0.2) : intent.confidence;

  return {
    chosenModule: intent.module,
    suggestedModules: suggestModules(intent.module, confidence),
    action,
    reasoning: localized(reasoning.key, {
      ...reasoning.params,
      isDuplicate: isLikelyDuplicateTask ? "yes" : "no",
    }),
    confidence,
  };
}

/** A short, human-readable one-liner describing what Axis will do. */
export function buildSummary(module: AxisModuleId, entities: EntityResult): LocalizedText {
  const subject = entities.title || "";
  const hasDueDate = entities.dueDate ? "yes" : "no";

  switch (module) {
    case "task":
      return localized("axisSummary.task", { subject, hasDueDate, dueDate: entities.dueDate ?? "" });
    case "memory":
      return localized("axisSummary.memory", { subject });
    case "document":
      return localized("axisSummary.document", { subject });
    case "shopping":
      return localized("axisSummary.shopping", { subject });
    case "conversation":
      return localized("axisSummary.conversation", { subject });
    default:
      return localized("axisSummary.unknown", { subject });
  }
}

export const routingEngine = { route, buildSummary };
