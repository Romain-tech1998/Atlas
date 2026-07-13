import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { missionService } from "@/services/missionService";
import { decisionService } from "@/services/decisionService";

interface AddUpdateBody {
  rawInput?: unknown;
}

export async function POST(request: NextRequest, ctx: RouteContext<"/api/missions/[id]/updates">) {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: missionId } = await ctx.params;

  const body = (await request.json().catch(() => null)) as AddUpdateBody | null;
  const rawInput = body?.rawInput;

  if (typeof rawInput !== "string" || rawInput.trim().length === 0) {
    return NextResponse.json({ error: "rawInput is required" }, { status: 400 });
  }

  try {
    const result = await missionService.addMissionUpdate(userId, missionId, rawInput);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof missionService.MissionNotFoundError) {
      return NextResponse.json({ error: "Mission not found" }, { status: 404 });
    }
    // Sprint-020 (RFC-0001 §4 "Mission Completion Semantics", architecture
    // decision 7): a terminal Mission cannot accept updates — a stable,
    // machine-readable code (correction 8), unlike the two mappings above,
    // which predate this sprint and are left exactly as they are.
    if (error instanceof missionService.MissionNotActiveError) {
      return NextResponse.json({ error: "MISSION_NOT_ACTIVE" }, { status: 409 });
    }
    // RFC-0001 §4 "Sequential Multi-Decision Missions" (Sprint-018,
    // correction 3): a genuine (if narrow) race starting the Mission's next
    // Decision — never a crash, never a silent duplicate.
    if (error instanceof decisionService.ConcurrentDecisionCreationError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
