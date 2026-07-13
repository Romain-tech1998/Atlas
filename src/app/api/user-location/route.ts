import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { runSkill } from "@/skills/skillEngine";
import { registerDefaultProviders } from "@/providers/registerDefaultProviders";
import { createResolveLocationSkill } from "@/skills/resolve-location";
import { createSetUserLocationSkill } from "@/skills/set-user-location";
import { OPEN_METEO_PROVIDER_ID } from "@/providers/open-meteo-provider";

/**
 * Sprint-027 (RFC-0001 §4 architecture correction 1): setting a location is
 * a settings-style user action, not a chat message — it mirrors the Google
 * Calendar connect/disconnect routes exactly (`POST`, auth-gated via
 * `auth()`, redirect back to `/providers` with a query-param notice/error),
 * never Atlas Brain/Axis. No intent parsing, no `ExecutionPlan`, no
 * learning signal — same as connecting/disconnecting a Provider.
 *
 * `registerDefaultProviders()` is called here for the same reason the
 * Providers page calls it before ever reading the Registry: the in-memory
 * Registry (`providerRegistry.ts`) starts empty in any request that hasn't
 * populated it, and a Route Handler is a separate request path from the
 * Providers page — it cannot assume the page's own call already ran.
 * `registerProvider` overwrites by id, so calling this on every request is
 * safe and idempotent, same as the page already relies on.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
  }

  registerDefaultProviders();

  const formData = await request.formData();
  const city = String(formData.get("city") ?? "").trim();
  if (!city) {
    return NextResponse.redirect(new URL("/providers?locationError=empty", request.url), { status: 303 });
  }

  const resolved = await runSkill(createResolveLocationSkill(OPEN_METEO_PROVIDER_ID), { city });
  if ("error" in resolved) {
    const code = resolved.error.code === "not_found" ? "not_found" : "unavailable";
    return NextResponse.redirect(new URL(`/providers?locationError=${code}`, request.url), { status: 303 });
  }

  await runSkill(createSetUserLocationSkill(session.user.id), {
    city: resolved.location.resolvedName,
    latitude: resolved.location.latitude,
    longitude: resolved.location.longitude,
  });

  return NextResponse.redirect(new URL("/providers?locationSuccess=1", request.url), { status: 303 });
}
