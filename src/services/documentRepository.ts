import { prisma } from "@/lib/prisma";
import { getProvider } from "@/providers/providerRegistry";
import { VOYAGE_EMBEDDING_PROVIDER_ID } from "@/providers/voyage-embedding-provider";
import type { EmbeddingProvider } from "@/providers/embedding-provider";

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
 * this repository never inspects, validates, or reshapes it.
 *
 * Sprint-035 (RFC-0003 §8h): also generates and stores the Document's
 * embedding at write time, not lazily on first search. `embedding` is an
 * `Unsupported("vector(1024)")` column — not writable through Prisma's
 * normal `create` call — so it's set via a follow-up raw `UPDATE`, casting
 * the embedding's pgvector text literal (`[0.1,0.2,...]`) to `vector`.
 * Embedding failure (no provider registered, `VOYAGE_API_KEY` unset, Voyage
 * unavailable) must not block saving the Document itself — a Document
 * without an embedding simply isn't yet semantically searchable
 * (`embedding IS NULL`, the same "absence is honest" pattern the schema's
 * nullable column already establishes), not a reason to fail the save. */
async function createDocument(
  userId: string,
  title: string,
  content: string,
  axisRequestId: string,
): Promise<DocumentRow> {
  const document = await prisma.document.create({ data: { userId, title, content, axisRequestId } });

  try {
    const provider = getProvider<EmbeddingProvider>(VOYAGE_EMBEDDING_PROVIDER_ID);
    if (provider) {
      const embedding = await provider.generateEmbedding(`${title}\n\n${content}`);
      const vectorLiteral = `[${embedding.join(",")}]`;
      await prisma.$executeRaw`UPDATE "Document" SET embedding = ${vectorLiteral}::vector WHERE id = ${document.id}`;
    }
  } catch (error) {
    console.error("Failed to generate embedding for Document", document.id, error);
  }

  return document;
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

export interface DocumentSimilarityMatch {
  id: string;
  title: string;
  content: string;
  similarity: number;
}

const MAX_SIMILARITY_MATCHES = 5;
/** Cosine similarity ranges -1..1; below this, a match is more "same rough
 * topic space" than "actually answers the question" for short, everyday
 * notes — picked as a reasonable MVP default for this Document length/style,
 * not derived from any formal tuning. A Document scoring below it is
 * dropped, not returned as a low-confidence guess (RFC-0003 §8h's own
 * "honest empty result" discipline). */
const SIMILARITY_THRESHOLD = 0.5;

/** Semantic search over one user's own Documents (Sprint-035, RFC-0003
 * §8h) — nearest by cosine distance (pgvector's `<=>` operator) to a
 * caller-supplied question embedding, scoped to `userId` in the same raw
 * query (never a cross-user search). `embedding IS NOT NULL` excludes
 * Documents that don't yet have one (written before this sprint, or whose
 * embedding call failed soft at write time) — their absence from results is
 * the same honest "not yet searchable" outcome as a Document nobody has
 * saved. Prisma's query builder has no vector-similarity operator, hence
 * `$queryRaw`. */
async function searchBySimilarity(userId: string, questionEmbedding: number[]): Promise<DocumentSimilarityMatch[]> {
  const vectorLiteral = `[${questionEmbedding.join(",")}]`;

  const rows = await prisma.$queryRaw<DocumentSimilarityMatch[]>`
    SELECT id, title, content, 1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
    FROM "Document"
    WHERE "userId" = ${userId} AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vectorLiteral}::vector
    LIMIT ${MAX_SIMILARITY_MATCHES}
  `;

  return rows.filter((row) => row.similarity >= SIMILARITY_THRESHOLD);
}

export const documentRepository = { createDocument, listDocuments, getDocumentById, searchBySimilarity };
