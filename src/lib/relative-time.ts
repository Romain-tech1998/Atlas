const UNITS: Array<{ limit: number; divisor: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { limit: 60, divisor: 1, unit: "second" },
  { limit: 3600, divisor: 60, unit: "minute" },
  { limit: 86400, divisor: 3600, unit: "hour" },
  { limit: 2592000, divisor: 86400, unit: "day" },
  { limit: 31536000, divisor: 2592000, unit: "month" },
];

/** "3 hours ago" / "il y a 3 heures", etc. — deterministic given `now`.
 * `justNowLabel` comes from the caller's own translator (common.justNow)
 * so this stays the only place "just now" text is defined. */
export function relativeTime(isoDate: string, now: Date, locale: string, justNowLabel: string): string {
  const deltaSeconds = Math.round((now.getTime() - new Date(isoDate).getTime()) / 1000);
  if (deltaSeconds < 10) return justNowLabel;

  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  for (const { limit, divisor, unit } of UNITS) {
    if (deltaSeconds < limit) {
      return formatter.format(-Math.floor(deltaSeconds / divisor), unit);
    }
  }

  return formatter.format(-Math.floor(deltaSeconds / 31536000), "year");
}
