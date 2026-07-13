import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { MemoryDraft, MemoryTypeId } from "./types";

type TransactionClient = Prisma.TransactionClient | PrismaClient;

async function saveMemory(userId: string, draft: MemoryDraft, client: TransactionClient = prisma): Promise<void> {
  await client.memory.create({
    data: {
      userId,
      type: draft.type,
      content: draft.content,
      source: draft.source,
    },
  });
}

export interface MemoryRow {
  id: string;
  type: MemoryTypeId;
  content: string;
  importance: number;
  source: string;
  createdAt: Date;
}

export interface ListMemoriesOptions {
  /** Sprint-012: a plain, case-insensitive substring match against
   * `content` only — no fuzzy matching, no stemming, no ranking. This is
   * filtering, not RFC-0003 §9's speculative `retrieve_memory`: the result
   * is still just a list, in the same recency order, only ever narrowed. */
  query?: string;
  limit?: number;
  offset?: number;
}

export interface MemoryPage {
  items: MemoryRow[];
  hasMore: boolean;
}

const DEFAULT_LIST_LIMIT = 20;

/** The user's Memory entries, most recent first (Sprint-009), optionally
 * filtered by a case-insensitive substring `query` against `content`
 * (Sprint-012) and paginated via `limit`/`offset` (offset, not cursor — see
 * RFC-0001 §4/Sprint-012: at this scale, one user's own Memories, cursor
 * pagination's main advantage isn't worth the complexity). Searching only
 * ever narrows the result set — the order is always `createdAt desc`,
 * never re-ranked. Filtering happens in the database query (Postgres
 * `contains`, case-insensitive), never fetched-then-filtered in JS.
 *
 * `hasMore` is computed by requesting one extra row past `limit` and
 * slicing it back off — cheap, exact, and avoids a separate `count()`
 * query. */
async function listMemories(userId: string, options: ListMemoriesOptions = {}): Promise<MemoryPage> {
  const { query, limit = DEFAULT_LIST_LIMIT, offset = 0 } = options;

  const rows = await prisma.memory.findMany({
    where: {
      userId,
      ...(query ? { content: { contains: query, mode: "insensitive" as const } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    skip: offset,
  });

  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}

/** Ownership-checked single Memory lookup — same pattern as
 * `decisionRepository.getDecisionById`. Used by `evidenceService`'s Path C
 * (Sprint-009) to resolve a `memoryId` before creating Evidence from it. */
async function getMemoryById(userId: string, memoryId: string): Promise<MemoryRow | null> {
  return prisma.memory.findFirst({ where: { id: memoryId, userId } });
}

export const memoryRepository = { saveMemory, listMemories, getMemoryById };
