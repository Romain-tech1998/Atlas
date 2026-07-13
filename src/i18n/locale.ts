export const LOCALES = ["en", "fr"] as const;
export type AppLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "en";
export const LOCALE_COOKIE_NAME = "atlas_locale";

export function isAppLocale(value: string | undefined | null): value is AppLocale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}
