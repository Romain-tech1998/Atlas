export const MEMORY_TYPES = ["FACT", "PREFERENCE", "EVENT", "CONTEXT"] as const;
export type MemoryTypeId = (typeof MEMORY_TYPES)[number];

/** A new Memory row Atlas Brain wants to persist, derived from a request. */
export interface MemoryDraft {
  type: MemoryTypeId;
  content: string;
  source: string;
}
