import "server-only";
import { ProviderError } from "@/providers/provider";
import type { EmbeddingProvider } from "@/providers/embedding-provider";

export const VOYAGE_EMBEDDING_PROVIDER_ID = "voyage_embedding";

const EMBEDDINGS_ENDPOINT = "https://api.voyageai.com/v1/embeddings";

/** `voyage-3.5` is Voyage AI's current general-purpose recommended model
 * (confirmed against Voyage's own docs at implementation time, not
 * assumed); its default output dimension is 1024, pinned explicitly here
 * to match `Document.embedding`'s fixed `vector(1024)` column regardless
 * of any future change to the model's own default. */
const MODEL = "voyage-3.5";
const OUTPUT_DIMENSION = 1024;

interface VoyageResponse {
  data?: Array<{ embedding?: number[] }>;
}

/** Pure mapping, unit-testable against fixture JSON — same reasoning as
 * `mapOpenMeteoResponse`. Throws on a missing/malformed embedding rather
 * than silently returning a zero-vector. */
export function mapVoyageResponse(body: VoyageResponse): number[] {
  const embedding = body.data?.[0]?.embedding;
  if (!embedding || embedding.length === 0) {
    throw new Error("Voyage response missing expected embedding.");
  }
  return embedding;
}

export const voyageEmbeddingProvider: EmbeddingProvider = {
  id: VOYAGE_EMBEDDING_PROVIDER_ID,
  name: "Voyage AI",
  capabilities: ["embedding:generate"],
  authType: "api_key",
  async generateEmbedding(text: string): Promise<number[]> {
    const apiKey = process.env.VOYAGE_API_KEY;
    if (!apiKey) throw new ProviderError("unauthorized", "VOYAGE_API_KEY is not set.");

    let response: Response;
    try {
      response = await fetch(EMBEDDINGS_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ input: [text], model: MODEL, output_dimension: OUTPUT_DIMENSION }),
      });
    } catch {
      throw new ProviderError("unavailable", "Could not reach Voyage AI.");
    }

    if (response.status === 401) throw new ProviderError("unauthorized", "Voyage API key was rejected.");
    if (!response.ok) throw new ProviderError("unavailable", "Voyage AI request failed.");

    try {
      const body = (await response.json()) as VoyageResponse;
      return mapVoyageResponse(body);
    } catch {
      throw new ProviderError("unavailable", "Voyage AI returned an unexpected response.");
    }
  },
};
