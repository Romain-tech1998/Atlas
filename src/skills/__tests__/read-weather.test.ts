import { describe, it, expect } from "vitest";
import { registerProvider } from "@/providers/providerRegistry";
import { createReadWeatherSkill } from "@/skills/read-weather";
import type { WeatherProvider, WeatherSnapshot } from "@/providers/weather-provider";

const FAKE_SNAPSHOT: WeatherSnapshot = {
  temperatureC: 18,
  windSpeedKmh: 5,
  weatherCode: 0,
  observedAt: "2026-07-13T12:00",
};

/** A plain fake external system, not a mock of `providerRegistry` or any
 * repository — same category of test double `find_lowest_value`'s tests
 * use for Evidence inputs. Records the coordinates it was called with so
 * the test can assert the Skill forwarded them unchanged. */
function createFakeWeatherProvider(id: string): { provider: WeatherProvider; calls: Array<[number, number]> } {
  const calls: Array<[number, number]> = [];
  const provider: WeatherProvider = {
    id,
    name: "Fake Weather",
    capabilities: ["weather:read"],
    authType: "none",
    status: "connected",
    async getCurrentWeather(latitude, longitude) {
      calls.push([latitude, longitude]);
      return FAKE_SNAPSHOT;
    },
  };
  return { provider, calls };
}

describe("createReadWeatherSkill", () => {
  it("forwards the given latitude/longitude straight through to the Provider, unchanged", async () => {
    const providerId = "fake_weather_test_provider";
    const { provider, calls } = createFakeWeatherProvider(providerId);
    registerProvider(provider);

    const skill = createReadWeatherSkill(providerId);
    const result = await skill.run({ latitude: 45.5017, longitude: -73.5673 });

    expect(calls).toEqual([[45.5017, -73.5673]]);
    expect(result).toEqual({ weather: FAKE_SNAPSHOT });
  });

  it("returns an unavailable error when the provider id doesn't resolve", async () => {
    const skill = createReadWeatherSkill("nonexistent_provider_id");
    const result = await skill.run({ latitude: 0, longitude: 0 });

    expect(result).toEqual({ error: { code: "unavailable" } });
  });
});
