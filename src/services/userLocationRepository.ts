import { prisma } from "@/lib/prisma";

export interface UserLocationRow {
  city: string;
  latitude: number;
  longitude: number;
  updatedAt: Date;
}

/** Sprint-027 — direct structural mirror of `atlasStateRepository.ts`: one
 * row per user, upserted, no separate create/update branching in the
 * caller. */
async function getLocation(userId: string): Promise<UserLocationRow | null> {
  return prisma.userLocation.findUnique({
    where: { userId },
    select: { city: true, latitude: true, longitude: true, updatedAt: true },
  });
}

async function upsertLocation(
  userId: string,
  city: string,
  latitude: number,
  longitude: number,
): Promise<UserLocationRow> {
  const data = { city, latitude, longitude };
  return prisma.userLocation.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
    select: { city: true, latitude: true, longitude: true, updatedAt: true },
  });
}

export const userLocationRepository = { getLocation, upsertLocation };
