import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { runSkill } from "@/skills/skillEngine";
import { registerDefaultProviders } from "@/providers/registerDefaultProviders";
import { createResearchMarketOptionsSkill } from "@/skills/research-market-options";
import { ANTHROPIC_AI_PROVIDER_ID } from "@/providers/anthropic-ai-provider";
import { evidenceService } from "@/services/evidenceService";

/**
 * Sprint-034 (RFC-0003 §8g): the explicit, cost-gated trigger for
 * `research_market_options` — never fired automatically. Plain,
 * auth-gated Route Handler calling `runSkill` directly, same position
 * outside `atlasBrain.runPipeline` as `/api/user-location`, but returns
 * JSON rather than a redirect since it's called from `evidence-form.tsx`'s
 * existing fetch-based submission UX, not a settings-page form post.
 *
 * Each returned option/value becomes ordinary Evidence through the exact
 * same `addEvidence` path structured/manual input already uses — no
 * bypass, no special "AI Evidence" table or flag. `recomputeVerdict`
 * needs no awareness that some Evidence came from here.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/decisions/[id]/research">) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: decisionId } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { subject?: unknown; criteria?: unknown } | null;

  const subject = body?.subject;
  if (typeof subject !== "string" || subject.trim().length === 0) {
    return NextResponse.json({ error: "subject is required" }, { status: 400 });
  }
  const criteria = Array.isArray(body?.criteria) ? body.criteria.filter((c): c is string => typeof c === "string") : [];

  registerDefaultProviders();

  const result = await runSkill(createResearchMarketOptionsSkill(ANTHROPIC_AI_PROVIDER_ID), {
    subject: subject.trim(),
    criteria,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error.code }, { status: result.error.code === "unauthorized" ? 401 : 502 });
  }

  for (const option of result.options) {
    for (const value of option.values) {
      await evidenceService.addEvidence(userId, decisionId, {
        claim: `${option.optionLabel}: ${value.value}${value.currency ? " " + value.currency : ""} ${value.measure}`,
        source: value.source,
        value: value.value,
        currency: value.currency,
        measure: value.measure,
        optionLabel: option.optionLabel,
      });
    }
  }

  return NextResponse.json({ addedOptions: result.options.length }, { status: 201 });
}
