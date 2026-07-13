import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { evidenceService } from "@/services/evidenceService";

/**
 * Sprint-012: backs the shared internal Evidence browser's search/"Load
 * more" for Documents — same reasoning and auth convention as
 * `GET /api/memories`.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query") ?? undefined;

  const limitParam = searchParams.get("limit");
  const limit = limitParam !== null ? Number(limitParam) : undefined;
  if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
    return NextResponse.json({ error: "limit must be a positive number" }, { status: 400 });
  }

  const offsetParam = searchParams.get("offset");
  const offset = offsetParam !== null ? Number(offsetParam) : undefined;
  if (offset !== undefined && (!Number.isFinite(offset) || offset < 0)) {
    return NextResponse.json({ error: "offset must be a non-negative number" }, { status: 400 });
  }

  const page = await evidenceService.listDocumentsForEvidence(userId, { query, limit, offset });
  return NextResponse.json(page);
}
