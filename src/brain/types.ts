import type { AxisStatusId } from "@/domain/axis";
import type { IntentResult } from "@/brain/intent/types";
import type { EntityResult } from "@/brain/entity/types";
import type { ContextBundle } from "@/brain/context/types";
import type { RoutingResult } from "@/brain/routing/types";
import type { ExecutionPlan } from "@/brain/planning/types";
import type { ScoreBreakdown } from "@/brain/scoring/types";
import type { LearningSignalTypeId } from "@/brain/learning/types";
import type { LocalizedText } from "@/i18n/message";

export interface LearningSignalView {
  id: string;
  type: LearningSignalTypeId;
  payload: Record<string, unknown>;
  createdAt: string;
}

/** The full, composed output of one Atlas Brain pipeline run — what the
 * API returns and what the UI renders. */
export interface AxisPipelineResult {
  id: string;
  rawInput: string;
  status: AxisStatusId;
  summary: LocalizedText;
  createdAt: string;
  intent: IntentResult;
  entities: EntityResult;
  context: ContextBundle;
  routing: RoutingResult;
  plan: ExecutionPlan;
  score: ScoreBreakdown;
  learningSignals: LearningSignalView[];
}
