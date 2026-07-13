import type { LocalizedText } from "./message";

/** Reserved key for text persisted before this app had i18n (plain English
 * strings stored in `AxisRequest.summary` / `AxisDecision.reasoning`).
 * Rendered as-is rather than translated, so old rows don't crash. */
const RAW_TEXT_KEY = "_raw";

export function rawLocalizedText(text: string): LocalizedText {
  return { key: RAW_TEXT_KEY, params: { text } };
}

/** Minimal shape both next-intl's server and client translators satisfy. */
type Translator = (key: string, params?: Record<string, string | number>) => string;

export function renderLocalized(t: Translator, text: LocalizedText): string {
  if (text.key === RAW_TEXT_KEY) {
    return String(text.params?.text ?? "");
  }
  return t(text.key, text.params);
}
