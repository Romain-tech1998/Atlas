import type { AxisModuleId } from "@/domain/axis";
import type { LocalizedText } from "@/i18n/message";

export type AutomationLevel = "manual" | "assisted" | "automatic";

export interface ExecutionStep {
  order: number;
  description: LocalizedText;
  module: AxisModuleId;
}

/** The plan Atlas Brain produces for executing a routed request. */
export interface ExecutionPlan {
  steps: ExecutionStep[];
  requiredModules: AxisModuleId[];
  missingInfo: string[];
  automationLevel: AutomationLevel;
}
