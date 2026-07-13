import { describe, it, expect } from "vitest";
import { resolveDueDateKeyword } from "@/domain/due-date";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function atMidnight(y: number, m: number, d: number) {
  return new Date(y, m, d);
}

describe("resolveDueDateKeyword", () => {
  // Wednesday, July 8 2026, deliberately not at midnight — confirms
  // time-of-day gets stripped, not just the date.
  const now = new Date(2026, 6, 8, 15, 30);

  it("resolves undefined -> undefined", () => {
    expect(resolveDueDateKeyword(undefined, now)).toBeUndefined();
  });

  it("resolves an unrecognized keyword -> undefined", () => {
    expect(resolveDueDateKeyword("someday", now)).toBeUndefined();
  });

  it("resolves 'today' to the same calendar day, stripped to midnight", () => {
    expect(resolveDueDateKeyword("today", now)).toEqual(atMidnight(2026, 6, 8));
  });

  it("resolves 'tonight' the same as 'today'", () => {
    expect(resolveDueDateKeyword("tonight", now)).toEqual(atMidnight(2026, 6, 8));
  });

  it("resolves 'tomorrow' to now + 1 day", () => {
    expect(resolveDueDateKeyword("tomorrow", now)).toEqual(atMidnight(2026, 6, 9));
  });

  it("resolves 'next week' to now + 7 days", () => {
    expect(resolveDueDateKeyword("next week", now)).toEqual(atMidnight(2026, 6, 15));
  });

  it("resolves a bare weekday equal to now's own weekday 7 days ahead, never today", () => {
    const todayName = WEEKDAYS[now.getDay()];
    expect(resolveDueDateKeyword(todayName, now)).toEqual(atMidnight(2026, 6, 15));
  });

  it("'next <weekday>' resolves identically to the bare form", () => {
    const todayName = WEEKDAYS[now.getDay()];
    const bare = resolveDueDateKeyword(todayName, now);
    const next = resolveDueDateKeyword(`next ${todayName}`, now);
    expect(next).toEqual(bare);
  });

  it("resolves a future weekday to the correct number of days ahead", () => {
    // now is Wednesday; Friday is 2 days ahead.
    expect(resolveDueDateKeyword("friday", now)).toEqual(atMidnight(2026, 6, 10));
  });

  it("resolves a past-this-week weekday to next week's occurrence, not a negative offset", () => {
    // now is Wednesday; Monday must resolve forward (5 days ahead), never
    // backward to the Monday that already passed.
    expect(resolveDueDateKeyword("monday", now)).toEqual(atMidnight(2026, 6, 13));
  });
});
