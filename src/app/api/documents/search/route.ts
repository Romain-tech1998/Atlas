import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { runSkill } from "@/skills/skillEngine";
import { registerDefaultProviders } from "@/providers/registerDefaultProviders";
import { createSearchDocumentsSemanticallySkill } from "@/skills/search-documents-semantically";
import { VOYAGE_EMBEDDING_PROVIDER_ID } from "@/providers/voyage-embedding-provider";

/**
 * Sprint-035 (RFC-0003 §8h): plain, auth-gated trigger for
 * `search_documents_semantically` — same shape as Sprint-034's
 * `/api/decisions/[id]/research` route (outside `atlasBrain.runPipeline`,
 * called directly from the Documents page's own fetch-based UX).
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { question?: unknown } | null;
  const question = body?.question;
  if (typeof question !== "string" || question.trim().length === 0) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  registerDefaultProviders();

  const result = await runSkill(createSearchDocumentsSemanticallySkill(userId, VOYAGE_EMBEDDING_PROVIDER_ID), {
    question: question.trim(),
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error.code }, { status: result.error.code === "unauthorized" ? 401 : 502 });
  }

  return NextResponse.json({ matches: result.matches });
}
