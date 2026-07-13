import { registerProvider } from "@/providers/providerRegistry";
import { mockCalendarProvider } from "@/providers/mock-calendar-provider";
import { openMeteoProvider } from "@/providers/open-meteo-provider";
import { GOOGLE_CALENDAR_PROVIDER_ID } from "@/services/googleCalendarConnectionService";

/**
 * Registration is explicit and idempotent, not automatic or discovered
 * (RFC-0003 §8b) — called wherever the Registry needs to be populated (the
 * Providers page), never as an import-time side effect buried in another
 * module. Safe to call more than once: `registerProvider` overwrites by id.
 *
 * The Google Calendar entry (RFC-0003 §8c) is a bare descriptor — no
 * `status` (its connection state is per-user, resolved separately from
 * `ExternalConnection`, never stored on the Registry) and no `getEvents`
 * (a real `CalendarProvider` instance is only ever built per-request, bound
 * to one user's tokens, via `createGoogleCalendarProvider(userId)` — never
 * registered here, never held in global state).
 */
export function registerDefaultProviders(): void {
  registerProvider(mockCalendarProvider);
  registerProvider({
    id: GOOGLE_CALENDAR_PROVIDER_ID,
    name: "Google Calendar",
    capabilities: ["calendar:read"],
    authType: "oauth",
  });
  registerProvider(openMeteoProvider);
}
