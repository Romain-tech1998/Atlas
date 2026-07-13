import { prisma } from "@/lib/prisma";
import { atlasStateRepository } from "@/brain/state/atlasStateRepository";
import { decodePersistedText } from "@/i18n/persisted-text";
import type { RawContextData } from "./types";

const RECENT_MEMORY_LIMIT = 20;
const RECENT_MISSION_LIMIT = 3;
const OPEN_TASK_LIMIT = 5;

/** Fetches the raw rows the Context Engine needs from Memory, AtlasState,
 * Mission, and Task. All Prisma access for context assembly lives here. */
async function getContextData(userId: string): Promise<RawContextData> {
  const [memories, missions, openTasks, atlasState] = await Promise.all([
    prisma.memory.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: RECENT_MEMORY_LIMIT,
      select: { id: true, content: true, type: true, createdAt: true },
    }),
    prisma.mission.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: RECENT_MISSION_LIMIT,
      select: { id: true, title: true },
    }),
    prisma.task.findMany({
      where: { userId, status: { in: ["TODO", "IN_PROGRESS"] } },
      orderBy: { createdAt: "desc" },
      take: OPEN_TASK_LIMIT,
      select: { id: true, title: true, status: true },
    }),
    atlasStateRepository.getState(userId),
  ]);

  return {
    memories,
    missions: missions.map((mission) => ({ id: mission.id, title: decodePersistedText(mission.title) })),
    openTasks,
    atlasState,
  };
}

export const contextRepository = { getContextData };
