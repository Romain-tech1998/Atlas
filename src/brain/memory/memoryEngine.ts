import type { IntentResult } from "@/brain/intent/types";
import type { EntityResult } from "@/brain/entity/types";
import type { MemoryDraft } from "./types";

/**
 * Deterministic memory extraction: a request only produces a memory when
 * it was routed to the memory module — everything else returns null.
 */
export function buildMemoryDraft(intent: IntentResult, entities: EntityResult): MemoryDraft | null {
  if (intent.module !== "memory") return null;

  return {
    type: "FACT",
    content: entities.title,
    source: "axis",
  };
}

export const memoryEngine = { buildMemoryDraft };
