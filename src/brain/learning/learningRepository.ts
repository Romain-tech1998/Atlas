import type { Prisma, PrismaClient, LearningSignalType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { LearningSignalDraft } from "./types";

type TransactionClient = Prisma.TransactionClient | PrismaClient;

function toPrismaSignalType(type: LearningSignalDraft["type"]): LearningSignalType {
  return type.toUpperCase() as LearningSignalType;
}

/** `axisRequestId` is nullable: most signals come from a pipeline run and
 * attach to the `AxisRequest` it produced, but some (e.g. `evidence_added`)
 * aren't tied to a pipeline run at all — those pass `null` explicitly. */
async function saveSignals(
  userId: string,
  axisRequestId: string | null,
  signals: LearningSignalDraft[],
  client: TransactionClient = prisma,
): Promise<void> {
  if (signals.length === 0) return;

  await client.learningSignal.createMany({
    data: signals.map((signal) => ({
      userId,
      axisRequestId,
      signalType: toPrismaSignalType(signal.type),
      payload: signal.payload as unknown as Prisma.InputJsonValue,
    })),
  });
}

export const learningRepository = { saveSignals };
