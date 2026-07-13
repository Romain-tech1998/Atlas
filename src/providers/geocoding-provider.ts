import type { Provider } from "@/providers/provider";

export interface GeocodingResult {
  latitude: number;
  longitude: number;
  /** Open-Meteo's own resolved display name (e.g. "Montreal, Quebec,
   * Canada") — shown back to the user so they can confirm what actually
   * got resolved, never re-derived or guessed here. */
  resolvedName: string;
}

export interface GeocodingProvider extends Provider {
  /** `null` means "no match" (not the same as a thrown `ProviderError`,
   * which means the request itself failed) — mirrors `ReadCalendarOutput`'s
   * discriminated-union discipline one level down, at the Provider
   * boundary instead of the Skill boundary. */
  resolveCity: (city: string) => Promise<GeocodingResult | null>;
}
