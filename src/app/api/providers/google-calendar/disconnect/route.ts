import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { revokeConnection } from "@/services/googleCalendarConnectionService";

/**
 * RFC-0003 §8c scope item 11: `POST`, not `GET` — this has a side effect.
 * Ownership is implicit: it only ever operates on the authenticated
 * caller's own connection, never an id supplied by the client.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
  }

  await revokeConnection(session.user.id);

  return NextResponse.redirect(new URL("/providers", request.url), { status: 303 });
}
