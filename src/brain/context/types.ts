import type { AtlasStateSnapshot } from "@/brain/state/types";
import type { LocalizedText } from "@/i18n/message";

export interface ContextMemoryItem {
  id: string;
  content: string;
  type: string;
  relevance: number;
}

export interface ContextMissionItem {
  id: string;
  title: LocalizedText | null;
}

export interface ContextTaskItem {
  id: string;
  title: string;
  status: string;
}

/** What Context Engine hands the rest of the pipeline: everything relevant
 * to this request, pulled from Memory, AtlasState, Mission, and Task. */
export interface ContextBundle {
  relevantMemories: ContextMemoryItem[];
  recentMissions: ContextMissionItem[];
  openTasks: ContextTaskItem[];
  atlasState: AtlasStateSnapshot | null;
}

/** Raw rows the Context Repository fetches, decoupled from Prisma's own types. */
export interface RawContextData {
  memories: Array<{ id: string; content: string; type: string; createdAt: Date }>;
  missions: Array<{ id: string; title: LocalizedText | null }>;
  openTasks: Array<{ id: string; title: string; status: string }>;
  atlasState: AtlasStateSnapshot | null;
}
