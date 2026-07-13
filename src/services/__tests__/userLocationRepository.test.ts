import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { userLocationRepository } from "@/services/userLocationRepository";
import { createTestUser, deleteTestUser } from "@/test/helpers";

describe("userLocationRepository", () => {
  let userId: string;

  beforeEach(async () => {
    userId = (await createTestUser()).id;
  });

  afterEach(async () => {
    await deleteTestUser(userId);
  });

  it("getLocation returns null before anything is set", async () => {
    const location = await userLocationRepository.getLocation(userId);
    expect(location).toBeNull();
  });

  it("upsertLocation then getLocation round-trips", async () => {
    await userLocationRepository.upsertLocation(userId, "Montreal, Quebec, Canada", 45.5017, -73.5673);

    const location = await userLocationRepository.getLocation(userId);
    expect(location).toMatchObject({
      city: "Montreal, Quebec, Canada",
      latitude: 45.5017,
      longitude: -73.5673,
    });
  });

  it("a second upsertLocation call overwrites rather than creating a second row", async () => {
    await userLocationRepository.upsertLocation(userId, "Montreal, Quebec, Canada", 45.5017, -73.5673);
    await userLocationRepository.upsertLocation(userId, "Paris, Ile-de-France, France", 48.8566, 2.3522);

    const count = await prisma.userLocation.count({ where: { userId } });
    expect(count).toBe(1);

    const location = await userLocationRepository.getLocation(userId);
    expect(location).toMatchObject({
      city: "Paris, Ile-de-France, France",
      latitude: 48.8566,
      longitude: 2.3522,
    });
  });
});
