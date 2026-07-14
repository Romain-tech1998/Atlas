import type { Skill } from "@/skills/skillEngine";
import { ProviderError } from "@/providers/provider";
import { getProvider } from "@/providers/providerRegistry";
import type { AIProvider, MarketOption } from "@/providers/ai-provider";

/** Mirrors `read-weather.ts`'s factory-resolves-by-id shape — the AI
 * Provider, like `openMeteoProvider`, is one shareable stateless instance
 * with no per-user identity, never Google Calendar's per-instance
 * variant. */
export interface ResearchMarketOptionsInput {
  subject: string;
  criteria: string[];
}

export interface ResearchMarketOptionsSuccess {
  options: MarketOption[];
}

export interface ResearchMarketOptionsFailure {
  error: { code: "unauthorized" | "unavailable" };
}

export type ResearchMarketOptionsOutput = ResearchMarketOptionsSuccess | ResearchMarketOptionsFailure;

export function createResearchMarketOptionsSkill(
  providerId: string,
): Skill<ResearchMarketOptionsInput, Promise<ResearchMarketOptionsOutput>> {
  return {
    id: "research_market_options",
    sideEffects: "external",
    async run({ subject, criteria }) {
      const provider = getProvider<AIProvider>(providerId);
      if (!provider) return { error: { code: "unavailable" } };

      try {
        const options = await provider.researchMarketOptions(subject, criteria);
        return { options };
      } catch (error) {
        const code = error instanceof ProviderError ? error.code : "unavailable";
        return { error: { code } };
      }
    },
  };
}
