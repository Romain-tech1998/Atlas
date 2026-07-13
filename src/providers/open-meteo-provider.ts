import "server-only";
import { ProviderError } from "@/providers/provider";
import type { WeatherProvider, WeatherSnapshot } from "@/providers/weather-provider";
import type { GeocodingProvider, GeocodingResult } from "@/providers/geocoding-provider";

export const OPEN_METEO_PROVIDER_ID = "open_meteo_weather";

const FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const GEOCODING_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";

interface OpenMeteoResponse {
  current?: {
    temperature_2m?: number;
    wind_speed_10m?: number;
    weather_code?: number;
    time?: string;
  };
}

interface OpenMeteoGeocodingResponse {
  results?: Array<{ name: string; latitude: number; longitude: number; admin1?: string; country?: string }>;
}

/** Pure mapping, factored out so it's unit-testable against fixed fixture
 * JSON without a real network call (see "Testing" below — the same reason
 * `google-calendar-provider.ts`'s own `mapEvent` is a standalone
 * function). Throws rather than silently defaulting fields to 0 if the
 * response is missing `current` entirely — a malformed response should
 * surface as `unavailable`, not a fake zero-degree reading. */
export function mapOpenMeteoResponse(body: OpenMeteoResponse): WeatherSnapshot {
  const current = body.current;
  if (
    !current ||
    current.temperature_2m === undefined ||
    current.wind_speed_10m === undefined ||
    current.weather_code === undefined ||
    !current.time
  ) {
    throw new Error("Open-Meteo response missing expected `current` fields.");
  }

  return {
    temperatureC: current.temperature_2m,
    windSpeedKmh: current.wind_speed_10m,
    weatherCode: current.weather_code,
    observedAt: current.time,
  };
}

/** Pure mapping for the geocoding endpoint, same "unit-testable without a
 * network call" reasoning as `mapOpenMeteoResponse`. `null` (not a thrown
 * error) for "no match" — an empty/missing `results` array is Open-Meteo
 * honestly saying nothing was found, not a malformed response. */
export function mapGeocodingResponse(body: OpenMeteoGeocodingResponse): GeocodingResult | null {
  const first = body.results?.[0];
  if (!first) return null;

  const parts = [first.name, first.admin1, first.country].filter(Boolean);
  return { latitude: first.latitude, longitude: first.longitude, resolvedName: parts.join(", ") };
}

/** One shareable, stateless instance — like `mockCalendarProvider`, but
 * real. `authType: "none"` and `status: "connected"` are both honest, not
 * placeholders standing in for unbuilt auth: there genuinely is nothing to
 * authenticate or connect for a public, keyless API. Satisfies both
 * `WeatherProvider` and `GeocodingProvider` — same vendor, same
 * statelessness, a second capability on the existing Provider entity, not
 * a second registered Provider (Sprint-027, RFC-0003 §8f). */
export const openMeteoProvider: WeatherProvider & GeocodingProvider = {
  id: OPEN_METEO_PROVIDER_ID,
  name: "Open-Meteo",
  capabilities: ["weather:read", "geocoding:read"],
  authType: "none",
  status: "connected",
  async getCurrentWeather(latitude: number, longitude: number): Promise<WeatherSnapshot> {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: "temperature_2m,wind_speed_10m,weather_code",
    });

    let response: Response;
    try {
      response = await fetch(`${FORECAST_ENDPOINT}?${params.toString()}`);
    } catch {
      throw new ProviderError("unavailable", "Could not reach Open-Meteo.");
    }

    if (!response.ok) {
      throw new ProviderError("unavailable", "Open-Meteo request failed.");
    }

    try {
      const body = (await response.json()) as OpenMeteoResponse;
      return mapOpenMeteoResponse(body);
    } catch {
      throw new ProviderError("unavailable", "Open-Meteo returned an unexpected response.");
    }
  },
  async resolveCity(city: string): Promise<GeocodingResult | null> {
    const params = new URLSearchParams({ name: city, count: "1" });

    let response: Response;
    try {
      response = await fetch(`${GEOCODING_ENDPOINT}?${params.toString()}`);
    } catch {
      throw new ProviderError("unavailable", "Could not reach Open-Meteo geocoding.");
    }

    if (!response.ok) {
      throw new ProviderError("unavailable", "Open-Meteo geocoding request failed.");
    }

    try {
      const body = (await response.json()) as OpenMeteoGeocodingResponse;
      return mapGeocodingResponse(body);
    } catch {
      throw new ProviderError("unavailable", "Open-Meteo geocoding returned an unexpected response.");
    }
  },
};
