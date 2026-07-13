/**
 * A translation key with the ICU params it needs, instead of a pre-formatted
 * string. Atlas Brain and the services above it produce these — never a
 * hardcoded English sentence — so the presentation layer can render the
 * same decision in whichever language the user has selected. The decision
 * logic that picks which key/params to use is unchanged from before i18n;
 * only the output shape (string -> key+params) changed.
 */
export interface LocalizedText {
  key: string;
  params?: Record<string, string | number>;
}

export function localized(key: string, params?: Record<string, string | number>): LocalizedText {
  return params ? { key, params } : { key };
}
