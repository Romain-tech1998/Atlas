import type { AxisIntentId, AxisModuleId } from "@/domain/axis";

/** Result of the Intent Engine: what the user wants, and which module owns it. */
export interface IntentResult {
  intent: AxisIntentId;
  module: AxisModuleId;
  confidence: number;
  /** The literal trigger phrase matched at the start of the input, if any. */
  triggerMatch: string | null;
}
