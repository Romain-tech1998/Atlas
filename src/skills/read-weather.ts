import type { Skill } from "@/skills/skillEngine";
import { ProviderError } from "@/providers/provider";
import { getProvider } from "@/providers/providerRegistry";
import type { WeatherProvider, WeatherSnapshot } from "@/providers/weather-provider";

/** Mirrors Sprint-014's original `read_calendar` shape (factory takes a
 * Registry id, resolves inside itself) rather than Sprint-015's
 * per-user-instance variant — correct here because `WeatherProvider`, like
 * `MockCalendarProvider`, is one shareable stateless instance, never bound
 * to a specific user.
 *
 * Sprint-027: `latitude`/`longitude` are now caller-supplied input, not a
 * hardcoded module constant — the caller (Providers page) already resolved
 * them from the user's own `UserLocation` row before calling this Skill.
 * This Skill still does no lookup of its own; it only forwards coordinates
 * to the Provider, same "Skill only persists/forwards, caller resolves"
 * split `create_task` established for due dates. */
export interface ReadWeatherInput {
  latitude: number;
  longitude: number;
}

export interface ReadWeatherSuccess {
  weather: WeatherSnapshot;
}

export interface ReadWeatherFailure {
  error: { code: "unavailable" };
}

export type ReadWeatherOutput = ReadWeatherSuccess | ReadWeatherFailure;

export function createReadWeatherSkill(providerId: string): Skill<ReadWeatherInput, Promise<ReadWeatherOutput>> {
  return {
    id: "read_weather",
    sideEffects: "external",
    async run({ latitude, longitude }) {
      const provider = getProvider<WeatherProvider>(providerId);
      if (!provider) return { error: { code: "unavailable" } };

      try {
        const weather = await provider.getCurrentWeather(latitude, longitude);
        return { weather };
      } catch (error) {
        const code = error instanceof ProviderError ? error.code : "unavailable";
        // WeatherProvider has no "unauthorized" failure mode (authType:
        // "none") — any ProviderError still narrows to "unavailable" here
        // since that's the only code this Skill's output type declares.
        return { error: { code: code === "unauthorized" ? "unavailable" : code } };
      }
    },
  };
}
