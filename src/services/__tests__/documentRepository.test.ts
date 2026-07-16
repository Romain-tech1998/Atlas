import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { documentRepository } from "@/services/documentRepository";
import { createTestUser, deleteTestUser } from "@/test/helpers";

const DIMENSION = 1024;

/** A one-hot vector — cheap to reason about: two one-hot vectors at the
 * same index are identical (cosine similarity 1), at different indices
 * they're orthogonal (cosine similarity 0, well below
 * `SIMILARITY_THRESHOLD`). No real Voyage API call anywhere in this file —
 * embeddings are set directly via raw SQL, the same way
 * `documentRepository.createDocument` itself writes one, just bypassing the
 * Provider so the test is deterministic and network-free. */
function oneHotVector(dominantIndex: number): number[] {
  const vector = new Array(DIMENSION).fill(0);
  vector[dominantIndex] = 1;
  return vector;
}

async function createDocumentWithEmbedding(userId: string, title: string, embedding: number[] | null) {
  const document = await prisma.document.create({
    data: { userId, title, content: `${title} content`, axisRequestId: null },
  });
  if (embedding) {
    const vectorLiteral = `[${embedding.join(",")}]`;
    await prisma.$executeRaw`UPDATE "Document" SET embedding = ${vectorLiteral}::vector WHERE id = ${document.id}`;
  }
  return document;
}

describe("documentRepository.searchBySimilarity", () => {
  let userAId: string;
  let userBId: string;

  beforeEach(async () => {
    userAId = (await createTestUser()).id;
    userBId = (await createTestUser()).id;
  });

  afterEach(async () => {
    await deleteTestUser(userAId);
    await deleteTestUser(userBId);
  });

  it("returns a Document whose embedding matches the query, with a similarity near 1", async () => {
    const queryEmbedding = oneHotVector(0);
    await createDocumentWithEmbedding(userAId, "Relevant note", queryEmbedding);

    const matches = await documentRepository.searchBySimilarity(userAId, queryEmbedding);

    expect(matches).toHaveLength(1);
    expect(matches[0].title).toBe("Relevant note");
    expect(matches[0].similarity).toBeGreaterThan(0.99);
  });

  it("never returns another user's Documents, even when that Document's embedding is an exact match", async () => {
    const queryEmbedding = oneHotVector(0);
    // userB's Document is a perfect match for the query — if per-user
    // scoping were broken, this is exactly what would leak into userA's
    // results (and would rank first, being an exact match).
    await createDocumentWithEmbedding(userBId, "Someone else's note", queryEmbedding);

    const matchesForUserA = await documentRepository.searchBySimilarity(userAId, queryEmbedding);
    expect(matchesForUserA).toHaveLength(0);

    // Sanity check: the same query against userB's own account does find it
    // — confirms the empty result above is genuine per-user scoping, not an
    // unrelated bug that would also hide it from its own owner.
    const matchesForUserB = await documentRepository.searchBySimilarity(userBId, queryEmbedding);
    expect(matchesForUserB).toHaveLength(1);
    expect(matchesForUserB[0].title).toBe("Someone else's note");
  });

  it("excludes Documents that don't have an embedding yet", async () => {
    const queryEmbedding = oneHotVector(0);
    await createDocumentWithEmbedding(userAId, "Not yet embedded", null);

    const matches = await documentRepository.searchBySimilarity(userAId, queryEmbedding);
    expect(matches).toHaveLength(0);
  });

  it("drops a Document whose embedding is too dissimilar to be a real match", async () => {
    const queryEmbedding = oneHotVector(0);
    // Orthogonal one-hot vector: cosine similarity 0, well under the
    // similarity threshold — an honest "not relevant", not a low-confidence
    // guess.
    await createDocumentWithEmbedding(userAId, "Unrelated note", oneHotVector(1));

    const matches = await documentRepository.searchBySimilarity(userAId, queryEmbedding);
    expect(matches).toHaveLength(0);
  });
});
