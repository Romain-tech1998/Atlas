import type { CalendarProvider } from "@/providers/calendar-provider";

/**
 * RFC-0003 §8b's one mock Provider (Sprint-014) — fixed, hardcoded events,
 * not date-relative ("tomorrow") text: deterministic means the same output
 * every run regardless of when the sprint is demoed, not just "not a real
 * network call." `status: "connected"` is hardcoded and never transitions
 * — there is no connect flow to trigger a transition, so building one here
 * would be speculative.
 */
export const mockCalendarProvider: CalendarProvider = {
  id: "mock_calendar",
  name: "Mock Calendar",
  capabilities: ["calendar:read"],
  authType: "none",
  status: "connected",
  getEvents: async () => [
    { id: "mock-1", title: "Team sync", start: "2026-07-13T14:00:00.000Z", allDay: false },
    { id: "mock-2", title: "Dentist appointment", start: "2026-07-15T09:30:00.000Z", allDay: false },
  ],
};
