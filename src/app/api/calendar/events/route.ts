import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { createGoogleCalendarProvider } from "@/providers/google-calendar-provider";
import { createReadCalendarSkill } from "@/skills/read-calendar";
import { runSkill } from "@/skills/skillEngine";

/** The shape the Evidence-from-Calendar picker (`EvidenceForm`) needs —
 * `CalendarEvent` (`src/providers/calendar-provider.ts`) minus `end`, which
 * Evidence never uses. */
export interface CalendarEventForEvidence {
  id: string;
  title: string;
  start: string;
  allDay: boolean;
}

export type CalendarEventsResponse =
  | { status: "connected"; items: CalendarEventForEvidence[]; hasMore: false }
  | { status: "reconnect_required" }
  | { status: "unavailable" };

/**
 * RFC-0001 §4 "Calendar Event Evidence — Path E": no repository — Calendar
 * is external, and the Provider (Sprint-015) already owns retrieval. All
 * three cases are valid, non-error 200s: "disconnected" and "no events" are
 * legitimate states the response body signals, not server errors. `query`
 * filters server-side (case-insensitive substring on `title`), same
 * discipline as every other Evidence-picker search since Sprint-012, even
 * though this data isn't DB-backed. There is no real pagination beneath
 * `read_calendar`'s fixed ≤10-event window, so `offset` isn't supported and
 * `hasMore` is always `false`.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query")?.trim().toLowerCase();

  const provider = createGoogleCalendarProvider(userId);
  const result = await runSkill(createReadCalendarSkill(provider), {});

  if ("error" in result) {
    const body: CalendarEventsResponse =
      result.error.code === "unauthorized" ? { status: "reconnect_required" } : { status: "unavailable" };
    return NextResponse.json(body);
  }

  const events = query ? result.events.filter((event) => event.title.toLowerCase().includes(query)) : result.events;

  const items: CalendarEventForEvidence[] = events.map((event) => ({
    id: event.id,
    title: event.title,
    start: event.start,
    allDay: event.allDay,
  }));

  const body: CalendarEventsResponse = { status: "connected", items, hasMore: false };
  return NextResponse.json(body);
}
