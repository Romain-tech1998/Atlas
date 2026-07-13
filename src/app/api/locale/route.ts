import { NextResponse } from "next/server";
import { isAppLocale, LOCALE_COOKIE_NAME } from "@/i18n/locale";

interface SetLocaleBody {
  locale?: unknown;
}

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as SetLocaleBody | null;
  const locale = body?.locale;

  if (typeof locale !== "string" || !isAppLocale(locale)) {
    return NextResponse.json({ error: "locale must be one of the supported locales" }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(LOCALE_COOKIE_NAME, locale, {
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
  });
  return response;
}
