import type { Provider } from "@/providers/provider";

/**
 * RFC-0003 §8b: the first narrow, per-capability Provider extension. A
 * future Gmail or Banking Provider gets its own interface the same way —
 * this file does not attempt to anticipate every capability with one
 * generic shape.
 */
export interface CalendarEvent {
  id: string;
  /** Falsy (missing from Google's response) when the source event has no
   * title — the Provider never invents display text; the Providers page
   * renders `t("providers.untitledEvent")` for a falsy title instead. */
  title: string;
  /** Verbatim from the source: an all-day event's date-only string
   * (`start.date`) or a timed event's ISO datetime (`start.dateTime`) —
   * never coerced into a midnight-UTC timestamp here. Format only where
   * the event is rendered, never in the Provider. */
  start: string;
  end?: string;
  allDay: boolean;
}

export interface CalendarProvider extends Provider {
  getEvents: () => Promise<CalendarEvent[]>;
}
