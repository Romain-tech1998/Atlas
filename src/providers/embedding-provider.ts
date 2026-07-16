import type { Provider } from "@/providers/provider";

/**
 * RFC-0003 §8h (Sprint-035): the narrow capability interface an
 * embeddings-backed Provider satisfies — mirrors `AIProvider`'s shape
 * (Sprint-034). A separate interface/Provider from `AIProvider`, not a
 * second capability on `anthropicAIProvider`: Anthropic's API has no
 * embeddings endpoint, confirmed against current docs before this was
 * written (§8g/§8h's own corrected assumption).
 */
export interface EmbeddingProvider extends Provider {
  generateEmbedding(text: string): Promise<number[]>;
}
