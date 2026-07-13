import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { decisionService } from "@/services/decisionService";

interface ResolveDecisionBody {
  outcome?: unknown;
  note?: unknown;
}

/**
 * RFC-0001 §4 "Verdict Acceptance" (Sprint-017): the only route that ever
 * moves a Decision to `RESOLVED` via explicit user action. `outcome` must
 * be exactly `"accepted"` or `"declined"`; `note` is required (non-empty)
 * for `"declined"` and ignored for `"accepted"` — the real gate is
 * `decisionService.resolveDecision`'s own validation, this is just a
 * boundary-level shape check (same discipline as the Evidence route).
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/decisions/[id]/resolve">) {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: decisionId } = await ctx.params;

  const body = (await request.json().catch(() => null)) as ResolveDecisionBody | null;
  const outcome = body?.outcome;

  if (outcome !== "accepted" && outcome !== "declined") {
    return NextResponse.json({ error: 'outcome must be "accepted" or "declined"' }, { status: 400 });
  }

  const note = body?.note;
  if (outcome === "declined" && (typeof note !== "string" || note.trim().length === 0)) {
    return NextResponse.json({ error: "note is required when declining" }, { status: 400 });
  }

  try {
    await decisionService.resolveDecision(userId, decisionId, {
      outcome,
      note: typeof note === "string" ? note : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof decisionService.DecisionNotFoundError) {
      return NextResponse.json({ error: "Decision not found" }, { status: 404 });
    }
    if (error instanceof decisionService.VerdictNotProducedError) {
      return NextResponse.json({ error: "Verdict not produced" }, { status: 409 });
    }
    if (error instanceof decisionService.DecisionAlreadyResolvedError) {
      return NextResponse.json({ error: "Decision already resolved" }, { status: 409 });
    }
    if (error instanceof decisionService.InvalidResolutionInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
