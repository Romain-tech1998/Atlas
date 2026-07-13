import type { LearningSignalDraft, PipelineTrace } from "./types";

/**
 * Deterministic signal derivation: reads the pipeline's own trace and
 * decides which of the automatic signal types apply. Pure — no I/O, no
 * randomness, same trace always produces the same signals.
 */
export function buildSignals(trace: PipelineTrace): LearningSignalDraft[] {
  const signals: LearningSignalDraft[] = [
    {
      type: "request_created",
      payload: { rawInputLength: trace.rawInput.length },
    },
  ];

  if (trace.intent.intent !== "unknown") {
    signals.push({
      type: "intent_detected",
      payload: {
        intent: trace.intent.intent,
        module: trace.intent.module,
        confidence: trace.intent.confidence,
      },
    });
  }

  if (trace.entities.keywords.length > 0 || trace.entities.dueDate) {
    signals.push({
      type: "entity_extracted",
      payload: {
        keywordCount: trace.entities.keywords.length,
        hasDueDate: Boolean(trace.entities.dueDate),
      },
    });
  }

  const hasContext =
    trace.context.relevantMemories.length > 0 ||
    trace.context.openTasks.length > 0 ||
    trace.context.atlasState !== null;
  if (hasContext) {
    signals.push({
      type: "context_used",
      payload: {
        memoryCount: trace.context.relevantMemories.length,
        openTaskCount: trace.context.openTasks.length,
        hadExistingState: trace.context.atlasState !== null,
      },
    });
  }

  signals.push({
    type: "module_suggested",
    payload: {
      chosenModule: trace.routing.chosenModule,
      suggestedModules: trace.routing.suggestedModules,
    },
  });

  signals.push({
    type: "plan_generated",
    payload: {
      stepsCount: trace.plan.steps.length,
      automationLevel: trace.plan.automationLevel,
      missingInfo: trace.plan.missingInfo,
    },
  });

  return signals;
}

export const learningEngine = { buildSignals };
