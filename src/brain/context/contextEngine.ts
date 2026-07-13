import type { EntityResult } from "@/brain/entity/types";
import type { ContextBundle, RawContextData } from "./types";

const RELEVANT_MEMORY_LIMIT = 5;

function scoreMemoryRelevance(content: string, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const lowerContent = content.toLowerCase();
  const matches = keywords.filter((keyword) => lowerContent.includes(keyword));
  return matches.length / keywords.length;
}

/**
 * Deterministic relevance ranking: scores each memory by how many of the
 * current request's keywords it contains, and falls back to "most recent"
 * when nothing overlaps, so the bundle is never empty for no reason.
 */
export function buildContextBundle(raw: RawContextData, entities: EntityResult): ContextBundle {
  const scoredMemories = raw.memories
    .map((memory) => ({
      id: memory.id,
      content: memory.content,
      type: memory.type,
      relevance: scoreMemoryRelevance(memory.content, entities.keywords),
    }))
    .sort((a, b) => b.relevance - a.relevance);

  const relevantMemories = scoredMemories.slice(0, RELEVANT_MEMORY_LIMIT);

  return {
    relevantMemories,
    recentMissions: raw.missions,
    openTasks: raw.openTasks,
    atlasState: raw.atlasState,
  };
}

export const contextEngine = { buildContextBundle };
