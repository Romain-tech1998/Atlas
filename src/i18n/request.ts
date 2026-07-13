import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, isAppLocale, LOCALE_COOKIE_NAME } from "./locale";

/**
 * No URL prefix (no /en/, /fr/) — the locale is stored in a cookie instead.
 * See the i18n recap for why: Atlas's routes were already established
 * before this sprint and this stays a presentation-only concern, with zero
 * changes to src/app's route structure. Falls back to the browser's
 * Accept-Language header on a user's very first visit (before any cookie
 * exists), then to English.
 */
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;

  let locale = DEFAULT_LOCALE;
  if (isAppLocale(cookieLocale)) {
    locale = cookieLocale;
  } else {
    const acceptLanguage = (await headers()).get("accept-language") ?? "";
    if (acceptLanguage.toLowerCase().startsWith("fr")) {
      locale = "fr";
    }
  }

  const messages: Record<string, unknown> = (await import(`../../messages/${locale}.json`)).default;

  return { locale, messages };
});
