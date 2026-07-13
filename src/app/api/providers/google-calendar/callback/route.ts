import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { encryptToken } from "@/lib/token-encryption";
import {
  exchangeCodeForTokens,
  GOOGLE_CALENDAR_PROVIDER_ID,
  OAUTH_STATE_COOKIE,
} from "@/services/googleCalendarConnectionService";
import { externalConnectionRepository } from "@/services/externalConnectionRepository";

/**
 * RFC-0003 §8c decision 2/8: validates the CSRF `state` exactly once against
 * the single-use cookie set by the connect route, then exchanges the code
 * and persists encrypted tokens. The authenticated `userId` always comes
 * from this route's own `auth()` session check — never from any
 * client-supplied value. Never puts a token, code, or raw Google error text
 * in the redirect URL, the rendered page, or a log line.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const userId = session.user.id;

  const cookieStore = await cookies();
  const cookieState = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(OAUTH_STATE_COOKIE);

  const { searchParams } = request.nextUrl;
  const queryState = searchParams.get("state");
  const googleError = searchParams.get("error");
  const code = searchParams.get("code");

  if (googleError) {
    // The user declined consent — an honest, distinct outcome, not a
    // generic error.
    return NextResponse.redirect(new URL("/providers?googleCalendarNotice=cancelled", request.url));
  }

  if (!cookieState || !queryState || cookieState !== queryState) {
    return NextResponse.redirect(new URL("/providers?googleCalendarError=state", request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL("/providers?googleCalendarError=missing_code", request.url));
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const accessTokenExpiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

    await externalConnectionRepository.upsertExternalConnection(userId, GOOGLE_CALENDAR_PROVIDER_ID, {
      status: "CONNECTED",
      encryptedAccessToken: encryptToken(tokens.accessToken),
      // Omit (rather than pass null) when Google didn't return one, so the
      // repository's preserve-existing-refresh-token rule applies.
      ...(tokens.refreshToken ? { encryptedRefreshToken: encryptToken(tokens.refreshToken) } : {}),
      accessTokenExpiresAt,
      grantedScopes: tokens.scope.split(" "),
    });
  } catch {
    return NextResponse.redirect(new URL("/providers?googleCalendarError=exchange_failed", request.url));
  }

  return NextResponse.redirect(new URL("/providers?googleCalendarSuccess=1", request.url));
}
