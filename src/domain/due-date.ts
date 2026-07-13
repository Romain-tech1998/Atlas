const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Local midnight of `date` plus `daysAhead` days — relies on `Date`'s own
 * day-of-month overflow handling (e.g. day 32 rolls into the next month
 * correctly), never a calendar library. Strips time-of-day: a due *date*,
 * not a due time. */
function midnightPlusDays(date: Date, daysAhead: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + daysAhead);
}

/**
 * Resolves one of entityEngine's DATE_KEYWORDS into a real Date, relative
 * to `now`. Pure function — `now` is always passed in by the caller, never
 * read internally, so this stays unit-testable without mocking the clock
 * (same discipline as every other engine under `src/brain/`).
 *
 * Rules (deliberately simple, no calendar library):
 * - "today" / "tonight" -> same calendar day as `now`.
 * - "tomorrow" -> `now` + 1 day.
 * - "next week" -> `now` + 7 days.
 * - a bare weekday ("monday") or "next <weekday>" -> the next occurrence
 *   of that weekday strictly after `now`'s calendar day, i.e. always in
 *   the future, never today, and both forms resolve identically. Treating
 *   a same-day match as "next week's" rather than "today" is the safer
 *   default when the phrasing is ambiguous — same reasoning
 *   `find_lowest_value` uses for `insufficientEvidence` over guessing.
 * - unrecognized keyword, or `keyword` undefined -> `undefined`.
 */
export function resolveDueDateKeyword(keyword: string | undefined, now: Date): Date | undefined {
  if (!keyword) return undefined;

  if (keyword === "today" || keyword === "tonight") return midnightPlusDays(now, 0);
  if (keyword === "tomorrow") return midnightPlusDays(now, 1);
  if (keyword === "next week") return midnightPlusDays(now, 7);

  const weekdayName = keyword.startsWith("next ") ? keyword.slice("next ".length) : keyword;
  const targetDay = WEEKDAYS.indexOf(weekdayName);
  if (targetDay === -1) return undefined;

  // "Next occurrence, never today": a same-weekday match must land 7 days
  // ahead, not 0 — `%7` alone would give 0 for that case, so `|| 7`
  // substitutes the full week whenever the raw offset is 0.
  const daysAhead = (targetDay - now.getDay() + 7) % 7 || 7;
  return midnightPlusDays(now, daysAhead);
}
