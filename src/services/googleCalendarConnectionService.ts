import "server-only";
import { ProviderError } from "@/providers/provider";
import { encryptToken, decryptToken } from "@/lib/token-encryption";
import { externalConnectionRepository } from "@/services/externalConnectionRepository";

/**
 * RFC-0003 §8c: OAuth/token-refresh orchestration for the Google Calendar
 * Provider — no Prisma calls here (delegated to
 * `externalConnectionRepository`), no UI concerns. `google-calendar-
 * provider.ts` calls only `getValidAccessToken`; the connect/callback/
 * disconnect API routes call the rest.
 */
export const GOOGLE_CALENDAR_PROVIDER_ID = "google_calendar";

/** The single-use CSRF cookie the connect route sets and the callback
 * route consumes (RFC-0003 §8c decision 2). Defined here, not in either
 * route file, since both need it and neither owns the other. */
export const OAUTH_STATE_COOKIE = "google_calendar_oauth_state";
export const OAUTH_STATE_MAX_AGE_SECONDS = 600;

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

/** Narrowest scope that covers listing events — "View events on all your
 * calendars" — deliberately not `calendar.readonly`, which also exposes
 * calendar list/settings this Provider never needs. */
const SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";

/** Refresh proactively inside this window before the stored expiry, so a
 * concurrent request never races an already-expired token to the Calendar
 * API. */
const EXPIRY_SKEW_MS = 60_000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new ProviderError("unavailable", `${name} is not configured.`);
  }
  return value;
}

export function buildAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CALENDAR_CLIENT_ID"),
    redirect_uri: requireEnv("GOOGLE_CALENDAR_REDIRECT_URI"),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return `${AUTHORIZATION_ENDPOINT}?${params.toString()}`;
}

export interface ExchangedTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scope: string;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export async function exchangeCodeForTokens(code: string): Promise<ExchangedTokens> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: requireEnv("GOOGLE_CALENDAR_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CALENDAR_CLIENT_SECRET"),
      redirect_uri: requireEnv("GOOGLE_CALENDAR_REDIRECT_URI"),
    }),
  });

  if (!response.ok) {
    throw new ProviderError("unavailable", "Google token exchange failed.");
  }

  const body = (await response.json()) as GoogleTokenResponse;
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresIn: body.expires_in,
    scope: body.scope,
  };
}

/** Loads the caller's `ExternalConnection`, refreshing the access token via
 * the stored refresh token if it's expired or about to expire, and returns
 * a valid plaintext access token. Never persists a plaintext token — only
 * holds it in memory for the immediate Calendar API call. At most one
 * refresh attempt; no retry loop. */
export async function getValidAccessToken(userId: string): Promise<string> {
  const connection = await externalConnectionRepository.getExternalConnection(userId, GOOGLE_CALENDAR_PROVIDER_ID);

  if (!connection || connection.status !== "CONNECTED" || !connection.encryptedAccessToken) {
    throw new ProviderError("unauthorized", "No active Google Calendar connection.");
  }

  const isExpired =
    !connection.accessTokenExpiresAt || connection.accessTokenExpiresAt.getTime() - EXPIRY_SKEW_MS <= Date.now();

  if (!isExpired) {
    return decryptToken(connection.encryptedAccessToken);
  }

  if (!connection.encryptedRefreshToken) {
    await externalConnectionRepository.recordExternalConnectionError(userId, GOOGLE_CALENDAR_PROVIDER_ID, "unauthorized");
    throw new ProviderError("unauthorized", "Google Calendar access expired and no refresh token is available.");
  }

  const refreshToken = decryptToken(connection.encryptedRefreshToken);

  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: requireEnv("GOOGLE_CALENDAR_CLIENT_ID"),
        client_secret: requireEnv("GOOGLE_CALENDAR_CLIENT_SECRET"),
      }),
    });
  } catch {
    throw new ProviderError("unavailable", "Could not reach Google to refresh the access token.");
  }

  if (!response.ok) {
    // A revoked/invalid grant is the specific case worth distinguishing —
    // everything else is a transient/unavailable failure, not a trust
    // problem with the connection itself.
    if (response.status === 400 || response.status === 401) {
      await externalConnectionRepository.recordExternalConnectionError(userId, GOOGLE_CALENDAR_PROVIDER_ID, "unauthorized");
      throw new ProviderError("unauthorized", "Google Calendar authorization was revoked or is no longer valid.");
    }
    throw new ProviderError("unavailable", "Google token refresh failed.");
  }

  const body = (await response.json()) as GoogleTokenResponse;
  const newExpiresAt = new Date(Date.now() + body.expires_in * 1000);

  await externalConnectionRepository.upsertExternalConnection(userId, GOOGLE_CALENDAR_PROVIDER_ID, {
    status: "CONNECTED",
    encryptedAccessToken: encryptToken(body.access_token),
    // Only overwrite if Google actually rotated it — otherwise omit so the
    // repository's preserve-existing-refresh-token rule keeps the one we
    // already have.
    ...(body.refresh_token ? { encryptedRefreshToken: encryptToken(body.refresh_token) } : {}),
    accessTokenExpiresAt: newExpiresAt,
  });

  return body.access_token;
}

/** Revokes the grant with Google where possible, but always clears the
 * local `ExternalConnection` regardless of the remote call's outcome — a
 * disconnect must never leave usable local credentials behind. */
export async function revokeConnection(userId: string): Promise<void> {
  const connection = await externalConnectionRepository.getExternalConnection(userId, GOOGLE_CALENDAR_PROVIDER_ID);

  if (connection?.encryptedAccessToken) {
    try {
      const accessToken = decryptToken(connection.encryptedAccessToken);
      await fetch(`${REVOKE_ENDPOINT}?${new URLSearchParams({ token: accessToken }).toString()}`, {
        method: "POST",
      });
    } catch {
      // Best-effort — the local disconnect below always happens regardless.
    }
  }

  await externalConnectionRepository.disconnectExternalConnection(userId, GOOGLE_CALENDAR_PROVIDER_ID);
}
