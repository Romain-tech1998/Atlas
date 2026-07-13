import { rawLocalizedText } from "./render";
import type { LocalizedText } from "./message";

/**
 * Several `String` columns (unchanged Prisma schema — see the i18n recap
 * for why) hold a JSON-encoded `LocalizedText` instead of plain text since
 * i18n landed: `AxisRequest.summary`, `AxisDecision.reasoning`,
 * `Mission.title`. Rows written before that change hold plain English
 * text instead; those decode as raw passthrough text rather than crashing.
 */
export function decodePersistedText(raw: string | null | undefined): LocalizedText | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof (parsed as LocalizedText).key === "string") {
      return parsed as LocalizedText;
    }
  } catch {
    // Not JSON — a pre-i18n row holding plain text.
  }
  return rawLocalizedText(raw);
}

export function encodePersistedText(text: LocalizedText): string {
  return JSON.stringify(text);
}
