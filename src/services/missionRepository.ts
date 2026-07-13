import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { MissionStatusId } from "@/domain/mission";
import type { LocalizedText } from "@/i18n/message";
import { decodePersistedText, encodePersistedText } from "@/i18n/persisted-text";

type TransactionClient = Prisma.TransactionClient | PrismaClient;

export interface MissionRow {
  id: string;
  goal: string;
  title: LocalizedText | null;
  status: MissionStatusId;
  /** Sprint-020 (RFC-0001 §4 "Mission Completion Semantics") — see
   * `prisma/schema.prisma`'s `Mission.outcomeAt`. */
  outcomeAt: Date | null;
  outcomeNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toMissionRow(row: {
  id: string;
  goal: string;
  title: string | null;
  status: MissionStatusId;
  outcomeAt: Date | null;
  outcomeNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}): MissionRow {
  return { ...row, title: decodePersistedText(row.title) };
}

async function createMission(userId: string, goal: string): Promise<MissionRow> {
  const row = await prisma.mission.create({
    data: { userId, goal },
  });
  return toMissionRow(row);
}

async function setMissionTitle(missionId: string, title: LocalizedText): Promise<void> {
  await prisma.mission.update({
    where: { id: missionId },
    data: { title: encodePersistedText(title) },
  });
}

/** Ownership-checked single mission lookup — returns null if it doesn't
 * exist or doesn't belong to this user. */
async function getMission(userId: string, missionId: string): Promise<MissionRow | null> {
  const row = await prisma.mission.findFirst({
    where: { id: missionId, userId },
  });
  return row ? toMissionRow(row) : null;
}

async function listMissionsForUser(userId: string): Promise<MissionRow[]> {
  const rows = await prisma.mission.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(toMissionRow);
}

export interface TransitionToTerminalStatusInput {
  status: Extract<MissionStatusId, "COMPLETED" | "ABANDONED">;
  outcomeAt: Date;
  outcomeNote: string | null;
}

/** Sprint-020 (RFC-0001 §4 "Mission Completion Semantics", scope 2): the
 * sole atomic write for a Mission's only two legal transitions
 * (`ACTIVE -> COMPLETED`/`ABANDONED`, architecture decision 4). No initial
 * read — the conditional `WHERE status = 'ACTIVE'` plus the affected-row
 * count is the entire guarantee (architecture decision 6): `true` means this
 * call won the transition, `false` means the Mission was already terminal
 * (or didn't exist/belong to this user) and the caller must disambiguate via
 * a follow-up read. Accepts an optional `client` so `missionService` can run
 * this inside the same transaction as the Decision archive (correction 4) —
 * same `tx`-threading shape as `atlasStateRepository.upsertState`. */
async function transitionToTerminalStatus(
  userId: string,
  missionId: string,
  input: TransitionToTerminalStatusInput,
  client: TransactionClient = prisma,
): Promise<boolean> {
  const result = await client.mission.updateMany({
    where: { id: missionId, userId, status: "ACTIVE" },
    data: { status: input.status, outcomeAt: input.outcomeAt, outcomeNote: input.outcomeNote },
  });
  return result.count === 1;
}

export const missionRepository = {
  createMission,
  setMissionTitle,
  getMission,
  listMissionsForUser,
  transitionToTerminalStatus,
};
