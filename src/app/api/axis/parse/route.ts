import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { atlasBrain } from "@/services/atlasBrain";

interface ParseRequestBody {
  rawInput?: unknown;
}

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as ParseRequestBody | null;
  const rawInput = body?.rawInput;

  if (typeof rawInput !== "string" || rawInput.trim().length === 0) {
    return NextResponse.json({ error: "rawInput is required" }, { status: 400 });
  }

  const result = await atlasBrain.runPipeline(userId, rawInput);

  return NextResponse.json(result, { status: 201 });
}
