import "server-only";
import { ProviderError } from "@/providers/provider";
import type { CalendarProvider, CalendarEvent } from "@/providers/calendar-provider";
import { getValidAccessToken, GOOGLE_CALENDAR_PROVIDER_ID } from "@/services/googleCalendarConnectionService";

/**
 * RFC-0003 §8c: no Prisma import, no OAuth/refresh logic — those live in
 * `googleCalendarConnectionService`. This module owns exactly one thing:
 * calling the Calendar REST API and mapping its response into
 * `CalendarEvent[]`. Plain `fetch`, not the `googleapis` package — three
 * read-only REST calls are simpler to audit than that SDK's full surface.
 *
 * `createGoogleCalendarProvider(userId)` returns a fresh instance per call,
 * bound to one user's tokens — it is never cached in module-level state and
 * never registered in the global Registry (RFC-0003 §8c item 6/decision 3).
 */
const EVENTS_ENDPOINT = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const MAX_RESULTS = 10;

interface GoogleEventTime {
  date?: string;
  dateTime?: string;
}

interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  start: GoogleEventTime;
  end?: GoogleEventTime;
}

interface GoogleEventsResponse {
  items?: GoogleCalendarEvent[];
}

function mapEvent(event: GoogleCalendarEvent): CalendarEvent {
  const allDay = !event.start.dateTime;
  const start = event.start.dateTime ?? event.start.date ?? "";
  const end = event.end?.dateTime ?? event.end?.date;

  return {
    id: event.id,
    // Never invent a title — a falsy value here means the Providers page
    // renders its own localized "untitled event" fallback.
    title: event.summary ?? "",
    start,
    end,
    allDay,
  };
}

export function createGoogleCalendarProvider(userId: string): CalendarProvider {
  return {
    id: GOOGLE_CALENDAR_PROVIDER_ID,
    name: "Google Calendar",
    capabilities: ["calendar:read"],
    authType: "oauth",
    async getEvents() {
      const accessToken = await getValidAccessToken(userId);

      const params = new URLSearchParams({
        timeMin: new Date().toISOString(),
        maxResults: String(MAX_RESULTS),
        singleEvents: "true",
        orderBy: "startTime",
      });

      let response: Response;
      try {
        response = await fetch(`${EVENTS_ENDPOINT}?${params.toString()}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch {
        throw new ProviderError("unavailable", "Could not reach the Google Calendar API.");
      }

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new ProviderError("unauthorized", "Google Calendar access was denied.");
        }
        throw new ProviderError("unavailable", "Google Calendar API request failed.");
      }

      const body = (await response.json()) as GoogleEventsResponse;
      return (body.items ?? []).map(mapEvent);
    },
  };
}
