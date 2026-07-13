import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { hasValidEncryptionKey } from "@/lib/token-encryption";
import {
  buildAuthorizationUrl,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE_SECONDS,
} from "@/services/googleCalendarConnectionService";

/**
 * RFC-0003 §8c decision 2: starts the real Google consent flow. The CSRF
 * `state` is an unsigned random value held only in a short-lived, single-
 * use, HttpOnly cookie — the callback route compares it for exact equality
 * and clears it immediately, so it can never be replayed.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Never start a flow that can't complete: the encryption key check and
  // `buildAuthorizationUrl`'s own required-env checks (client id, redirect
  // URI) both gate this before Google is ever involved or a cookie is set.
  let authorizationUrl: string;
  const state = randomBytes(32).toString("base64url");
  try {
    if (!hasValidEncryptionKey()) {
      throw new Error("ATLAS_TOKEN_ENCRYPTION_KEY is not configured.");
    }
    authorizationUrl = buildAuthorizationUrl(state);
  } catch {
    return NextResponse.redirect(new URL("/providers?googleCalendarError=config", request.url));
  }

  const cookieStore = await cookies();
  cookieStore.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
    path: "/",
  });

  return NextResponse.redirect(authorizationUrl);
}
