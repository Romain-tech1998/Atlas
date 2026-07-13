import type { AxisModuleId } from "@/domain/axis";
import type { LocalizedText } from "@/i18n/message";

/** Atlas Brain's routing decision for a request. */
export interface RoutingResult {
  chosenModule: AxisModuleId;
  suggestedModules: AxisModuleId[];
  /** Technical action id, e.g. "create_task_draft" — stays a stable
   * identifier across locales, same treatment as "Axis" itself. */
  action: string;
  reasoning: LocalizedText;
  confidence: number;
}
