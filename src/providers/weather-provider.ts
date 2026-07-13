import type { Provider } from "@/providers/provider";

/** Second narrow Provider capability extension, after `CalendarProvider`
 * (RFC-0003 §8b names Gmail/Banking as the anticipated next examples —
 * Weather is the one actually built, chosen for a different `authType`,
 * not a different domain). */
export interface WeatherSnapshot {
  temperatureC: number;
  windSpeedKmh: number;
  /** Open-Meteo's WMO weather code (0 = clear sky, 61 = rain, etc.) —
   * stored as-is, never translated to a label here; the Providers page
   * maps a small known subset to display text, unknown codes fall back to
   * showing the raw code (same "never invent, degrade honestly" rule
   * `calendar-provider.ts`'s `title` field already follows). */
  weatherCode: number;
  /** Verbatim ISO timestamp from Open-Meteo's `current.time` — never
   * reformatted here, same discipline as `CalendarEvent.start`. */
  observedAt: string;
}

export interface WeatherProvider extends Provider {
  /** Sprint-027: `latitude`/`longitude` are caller-supplied — the Provider
   * itself has no notion of "whose" weather this is, same statelessness
   * as before, just parameterized instead of fixed to one hardcoded
   * location. */
  getCurrentWeather: (latitude: number, longitude: number) => Promise<WeatherSnapshot>;
}
