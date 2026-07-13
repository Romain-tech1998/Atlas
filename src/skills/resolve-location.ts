import type { Skill } from "@/skills/skillEngine";
import { ProviderError } from "@/providers/provider";
import { getProvider } from "@/providers/providerRegistry";
import type { GeocodingProvider, GeocodingResult } from "@/providers/geocoding-provider";

export interface ResolveLocationInput {
  city: string;
}

export interface ResolveLocationSuccess {
  location: GeocodingResult;
}

export interface ResolveLocationFailure {
  error: { code: "not_found" | "unavailable" };
}

export type ResolveLocationOutput = ResolveLocationSuccess | ResolveLocationFailure;

/** Same registry-id factory shape as `read_weather` (Sprint-026) — the
 * Geocoding capability is on the same shareable, stateless
 * `openMeteoProvider` instance. */
export function createResolveLocationSkill(
  providerId: string,
): Skill<ResolveLocationInput, Promise<ResolveLocationOutput>> {
  return {
    id: "resolve_location",
    sideEffects: "external",
    async run({ city }) {
      const provider = getProvider<GeocodingProvider>(providerId);
      if (!provider) return { error: { code: "unavailable" } };

      try {
        const location = await provider.resolveCity(city);
        if (!location) return { error: { code: "not_found" } };
        return { location };
      } catch (error) {
        const code = error instanceof ProviderError ? error.code : "unavailable";
        return { error: { code: code === "unauthorized" ? "unavailable" : code } };
      }
    },
  };
}
