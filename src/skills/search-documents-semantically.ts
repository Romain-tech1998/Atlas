import type { Skill } from "@/skills/skillEngine";
import { ProviderError } from "@/providers/provider";
import { getProvider } from "@/providers/providerRegistry";
import type { EmbeddingProvider } from "@/providers/embedding-provider";
import { documentRepository } from "@/services/documentRepository";

export interface SearchDocumentsSemanticallyInput {
  question: string;
}

export interface DocumentMatch {
  documentId: string;
  title: string;
  content: string;
  similarity: number;
}

export interface SearchDocumentsSemanticallySuccess {
  matches: DocumentMatch[];
}

export interface SearchDocumentsSemanticallyFailure {
  error: { code: "unauthorized" | "unavailable" };
}

export type SearchDocumentsSemanticallyOutput =
  | SearchDocumentsSemanticallySuccess
  | SearchDocumentsSemanticallyFailure;

/**
 * RFC-0003 §8h (Sprint-035): the Document module's "drive intelligent"
 * Skill — embeds `question` via the Voyage Provider, then finds the user's
 * own nearest Documents by cosine distance (`documentRepository.
 * searchBySimilarity`, which both scopes to `userId` and drops anything
 * below a reasonable similarity threshold). `userId` is ambient context of
 * one specific call, not part of the input/output contract — same factory
 * shape as `createSaveDocumentSkill`, not `research_market_options`'s
 * stateless-singleton shape, since this Skill's whole point is a per-user
 * search. An empty `matches` array is an honest "nothing relevant found"
 * result, exactly as valid as a real match — never a fabricated low-
 * confidence guess (same discipline as `research_market_options`).
 */
export function createSearchDocumentsSemanticallySkill(
  userId: string,
  providerId: string,
): Skill<SearchDocumentsSemanticallyInput, Promise<SearchDocumentsSemanticallyOutput>> {
  return {
    id: "search_documents_semantically",
    sideEffects: "external",
    async run({ question }) {
      const provider = getProvider<EmbeddingProvider>(providerId);
      if (!provider) return { error: { code: "unavailable" } };

      try {
        const questionEmbedding = await provider.generateEmbedding(question);
        const rows = await documentRepository.searchBySimilarity(userId, questionEmbedding);
        const matches = rows.map((row) => ({
          documentId: row.id,
          title: row.title,
          content: row.content,
          similarity: row.similarity,
        }));
        return { matches };
      } catch (error) {
        const code = error instanceof ProviderError ? error.code : "unavailable";
        return { error: { code } };
      }
    },
  };
}
