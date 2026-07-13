import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { AtlasStateSnapshot } from "./types";

type TransactionClient = Prisma.TransactionClient | PrismaClient;

function toSnapshot(row: {
  activeDomains: unknown;
  priorities: string[];
  preferences: unknown;
  activeProjects: string[];
  openTaskCount: number;
}): AtlasStateSnapshot {
  return {
    activeDomains: (row.activeDomains as Record<string, number>) ?? {},
    priorities: row.priorities,
    preferences: (row.preferences as Record<string, string>) ?? {},
    activeProjects: row.activeProjects,
    openTaskCount: row.openTaskCount,
  };
}

async function getState(userId: string, client: TransactionClient = prisma): Promise<AtlasStateSnapshot | null> {
  const row = await client.atlasState.findUnique({ where: { userId } });
  return row ? toSnapshot(row) : null;
}

async function upsertState(
  userId: string,
  snapshot: AtlasStateSnapshot,
  client: TransactionClient = prisma,
): Promise<AtlasStateSnapshot> {
  const data = {
    activeDomains: snapshot.activeDomains,
    priorities: snapshot.priorities,
    preferences: snapshot.preferences,
    activeProjects: snapshot.activeProjects,
    openTaskCount: snapshot.openTaskCount,
    lastInteractionAt: new Date(),
  };

  const row = await client.atlasState.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });

  return toSnapshot(row);
}

export const atlasStateRepository = { getState, upsertState };
