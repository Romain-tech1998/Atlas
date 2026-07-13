import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { missionService } from "@/services/missionService";

/** Sprint-020 (RFC-0001 §4 "Mission Completion Semantics", architecture
 * decision 4): the only two legal transitions this route accepts —
 * `"ACTIVE"` is no longer a meaningful target (there is no reactivation). */
const TERMINAL_MISSION_STATUSES = ["COMPLETED", "ABANDONED"] as const;
type TerminalMissionStatus = (typeof TERMINAL_MISSION_STATUSES)[number];

interface SetStatusBody {
  status?: unknown;
  note?: unknown;
}

function isTerminalMissionStatus(value: unknown): value is TerminalMissionStatus {
  return typeof value === "string" && (TERMINAL_MISSION_STATUSES as readonly string[]).includes(value);
}

export async function POST(request: NextRequest, ctx: RouteContext<"/api/missions/[id]/status">) {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: missionId } = await ctx.params;

  const body = (await request.json().catch(() => null)) as SetStatusBody | null;
  const status = body?.status;

  if (!isTerminalMissionStatus(status)) {
    return NextResponse.json({ error: "status must be one of COMPLETED, ABANDONED" }, { status: 400 });
  }

  const noteInput = body?.note;
  if (noteInput !== undefined && typeof noteInput !== "string") {
    return NextResponse.json({ error: "note must be a string" }, { status: 400 });
  }

  try {
    const summary = await missionService.setMissionStatus(userId, missionId, status, noteInput);
    return NextResponse.json(summary);
  } catch (error) {
    if (error instanceof missionService.MissionNotFoundError) {
      return NextResponse.json({ error: "Mission not found" }, { status: 404 });
    }
    // Sprint-020 (correction 8): a stable, machine-readable code — the
    // client maps this to localized copy, never a raw English message.
    if (error instanceof missionService.MissionAlreadyTerminalError) {
      return NextResponse.json({ error: "MISSION_ALREADY_TERMINAL" }, { status: 409 });
    }
    if (error instanceof missionService.InvalidMissionTransitionError) {
      return NextResponse.json({ error: "Invalid mission status transition" }, { status: 400 });
    }
    throw error;
  }
}
