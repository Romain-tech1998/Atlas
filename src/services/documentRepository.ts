import { prisma } from "@/lib/prisma";

export interface DocumentRow {
  id: string;
  userId: string;
  axisRequestId: string | null;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Persists a real `Document` row (Sprint-010, RFC-0003 §9 `save_document`)
 * — `Document.axisRequestId` already existed in the schema since before
 * this sprint, unused until now. `content` is stored exactly as given;
 * this repository never inspects, validates, or reshapes it. */
async function createDocument(
  userId: string,
  title: string,
  content: string,
  axisRequestId: string,
): Promise<DocumentRow> {
  return prisma.document.create({ data: { userId, title, content, axisRequestId } });
}

export interface ListDocumentsOptions {
  /** Sprint-012: a plain, case-insensitive substring match against `title`
   * OR `content` — no fuzzy matching, no ranking. Filtering, not
   * RFC-0003 §9's speculative `retrieve_memory`-style relevance search. */
  query?: string;
  limit?: number;
  offset?: number;
}

export interface DocumentPage {
  items: DocumentRow[];
  hasMore: boolean;
}

const DEFAULT_LIST_LIMIT = 20;

/** The user's Documents, most recent first, for the Documents view
 * (Sprint-010), optionally filtered by a case-insensitive substring `query`
 * against `title` or `content` (Sprint-012) and paginated via
 * `limit`/`offset` (offset, not cursor — same reasoning as
 * `memoryRepository.listMemories`). Searching only narrows the result set;
 * order is always `createdAt desc`. Filtering happens in the database
 * query, never fetched-then-filtered in JS.
 *
 * `hasMore` is computed by requesting one extra row past `limit` and
 * slicing it back off. */
async function listDocuments(userId: string, options: ListDocumentsOptions = {}): Promise<DocumentPage> {
  const { query, limit = DEFAULT_LIST_LIMIT, offset = 0 } = options;

  const rows = await prisma.document.findMany({
    where: {
      userId,
      ...(query
        ? {
            OR: [
              { title: { contains: query, mode: "insensitive" as const } },
              { content: { contains: query, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    skip: offset,
  });

  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}

/** Ownership-checked single Document lookup — same pattern as
 * `memoryRepository.getMemoryById`/`decisionRepository.getDecisionById`.
 * Used by `evidenceService`'s Path D (Sprint-011) to resolve a `documentId`
 * before creating Evidence from one of its excerpts. */
async function getDocumentById(userId: string, documentId: string): Promise<DocumentRow | null> {
  return prisma.document.findFirst({ where: { id: documentId, userId } });
}

export const documentRepository = { createDocument, listDocuments, getDocumentById };
