import type { Skill } from "@/skills/skillEngine";
import { ProviderError } from "@/providers/provider";
import type { CalendarProvider, CalendarEvent } from "@/providers/calendar-provider";

/**
 * RFC-0003 §8c: `read_calendar` now takes a `CalendarProvider` instance
 * directly, not a Registry id (Sprint-014's shape) — correct for Mock (one
 * shareable stateless instance) but wrong for Google, where the Provider
 * must be bound to one authenticated user's tokens and must never be
 * resolved from global state. The caller (Providers page) builds the right
 * instance — `mockCalendarProvider` directly, or a fresh
 * `createGoogleCalendarProvider(userId)` per request — and passes it in.
 *
 * Async because `CalendarProvider.getEvents` is now
 * `() => Promise<CalendarEvent[]>` (Google requires a network call).
 * `runSkill` (`src/skills/skillEngine.ts`) needed no change — its generic
 * `TOutput` already passes a `Promise` straight through, per Sprint-010's
 * `save_document` precedent.
 *
 * A thrown `ProviderError` (e.g. a revoked Google grant) is caught here and
 * mapped into the failure branch of `ReadCalendarOutput` — RFC-0003 §6's
 * "failed skills must return structured errors, never a bare exception"
 * applies to this Skill's own handling of a thrown Provider error.
 */
export type ReadCalendarInput = Record<string, never>;

export interface ReadCalendarSuccess {
  events: CalendarEvent[];
}

export interface ReadCalendarFailure {
  error: { code: "unauthorized" | "unavailable" };
}

export type ReadCalendarOutput = ReadCalendarSuccess | ReadCalendarFailure;

export function createReadCalendarSkill(
  provider: CalendarProvider,
): Skill<ReadCalendarInput, Promise<ReadCalendarOutput>> {
  return {
    id: "read_calendar",
    sideEffects: "external",
    async run() {
      try {
        const events = await provider.getEvents();
        return { events };
      } catch (error) {
        const code = error instanceof ProviderError ? error.code : "unavailable";
        return { error: { code } };
      }
    },
  };
}
