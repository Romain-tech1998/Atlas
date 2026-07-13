import { prisma } from "@/lib/prisma";
import type { ExternalConnectionStatus } from "@/generated/prisma/enums";

export interface ExternalConnectionRow {
  id: string;
  userId: string;
  providerId: string;
  status: ExternalConnectionStatus;
  encryptedAccessToken: string | null;
  encryptedRefreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  grantedScopes: unknown;
  providerAccountId: string | null;
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** RFC-0003 §8c: Prisma access only — no OAuth logic. One row per
 * (user, Provider) pair, matching the `@@unique([userId, providerId])`
 * constraint on the model. */
async function getExternalConnection(userId: string, providerId: string): Promise<ExternalConnectionRow | null> {
  return prisma.externalConnection.findUnique({ where: { userId_providerId: { userId, providerId } } });
}

export interface UpsertExternalConnectionData {
  status: ExternalConnectionStatus;
  encryptedAccessToken?: string | null;
  /** Omit (leave `undefined`) to preserve whatever refresh token is already
   * stored — Google doesn't always return a new one on reconnect/refresh,
   * and a valid stored refresh token must never be overwritten with null
   * just because this call didn't receive a new one. Pass `null` explicitly
   * only to deliberately clear it (e.g. on disconnect). */
  encryptedRefreshToken?: string | null;
  accessTokenExpiresAt?: Date | null;
  grantedScopes?: string[];
  providerAccountId?: string | null;
  lastErrorCode?: string | null;
}

async function upsertExternalConnection(
  userId: string,
  providerId: string,
  data: UpsertExternalConnectionData,
): Promise<ExternalConnectionRow> {
  const { encryptedRefreshToken, ...rest } = data;

  return prisma.externalConnection.upsert({
    where: { userId_providerId: { userId, providerId } },
    create: {
      userId,
      providerId,
      ...rest,
      encryptedRefreshToken: encryptedRefreshToken ?? null,
    },
    update: {
      ...rest,
      // Only touch the column when a value was actually supplied — this is
      // the preserve-existing-refresh-token rule (RFC-0003 §8c scope item 4).
      ...(encryptedRefreshToken !== undefined ? { encryptedRefreshToken } : {}),
    },
  });
}

async function disconnectExternalConnection(userId: string, providerId: string): Promise<void> {
  await prisma.externalConnection.updateMany({
    where: { userId, providerId },
    data: {
      status: "DISCONNECTED",
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
      accessTokenExpiresAt: null,
      lastErrorCode: null,
    },
  });
}

async function recordExternalConnectionError(userId: string, providerId: string, code: string): Promise<void> {
  await prisma.externalConnection.updateMany({
    where: { userId, providerId },
    data: { status: "ERROR", lastErrorCode: code },
  });
}

export const externalConnectionRepository = {
  getExternalConnection,
  upsertExternalConnection,
  disconnectExternalConnection,
  recordExternalConnectionError,
};
