/**
 * Shared Axis vocabulary used across the Atlas Brain engines
 * (src/brain/*). Kept dependency-free so every engine can import it
 * without creating cross-engine coupling.
 */

export const AXIS_MODULES = [
  "task",
  "document",
  "memory",
  "conversation",
  "shopping",
  "travel",
  "unknown",
] as const;

export type AxisModuleId = (typeof AXIS_MODULES)[number];

export const AXIS_INTENTS = [
  "create_task",
  "store_memory",
  "create_document",
  "ask_question",
  "compare_shopping_options",
  "compare_travel_options",
  "unknown",
] as const;

export type AxisIntentId = (typeof AXIS_INTENTS)[number];

export const AXIS_STATUSES = ["PENDING", "PARSED", "FAILED"] as const;

export type AxisStatusId = (typeof AXIS_STATUSES)[number];
