import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { evidenceService, type AddEvidenceInput } from "@/services/evidenceService";

interface AddEvidenceBody {
  claim?: unknown;
  source?: unknown;
  value?: unknown;
  currency?: unknown;
  measure?: unknown;
  observedAt?: unknown;
  optionLabel?: unknown;
  memoryId?: unknown;
  documentId?: unknown;
  excerpt?: unknown;
  calendarEventId?: unknown;
}

/** Boundary-level type checking only (Sprint-008: is `value` a number? is
 * `currency` a string?) — the actual business rules (currency requires a
 * value, measure must be recognized, etc.) live server-side in
 * `evidenceService.validateStructuredInput`, not here. */
function parseOptionalNumber(raw: unknown): { ok: true; value: number | undefined } | { ok: false } {
  if (raw === undefined) return { ok: true, value: undefined };
  return typeof raw === "number" ? { ok: true, value: raw } : { ok: false };
}

function parseOptionalString(raw: unknown): { ok: true; value: string | undefined } | { ok: false } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== "string") return { ok: false };
  const trimmed = raw.trim();
  return { ok: true, value: trimmed.length > 0 ? trimmed : undefined };
}

export async function POST(request: NextRequest, ctx: RouteContext<"/api/decisions/[id]/evidence">) {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: decisionId } = await ctx.params;

  const body = (await request.json().catch(() => null)) as AddEvidenceBody | null;

  // Path C (Sprint-009): a `memoryId` request carries no claim/source of its
  // own — those are derived from the Memory — so it's handled entirely
  // separately from Path A/B's claim-required body below.
  const memoryId = body?.memoryId;
  if (memoryId !== undefined) {
    if (typeof memoryId !== "string" || memoryId.trim().length === 0) {
      return NextResponse.json({ error: "memoryId must be a non-empty string" }, { status: 400 });
    }
    try {
      const evidence = await evidenceService.addEvidenceFromMemory(userId, decisionId, memoryId.trim());
      return NextResponse.json(evidence, { status: 201 });
    } catch (error) {
      if (error instanceof evidenceService.DecisionNotFoundError) {
        return NextResponse.json({ error: "Decision not found" }, { status: 404 });
      }
      if (error instanceof evidenceService.MemoryNotFoundError) {
        return NextResponse.json({ error: "Memory not found" }, { status: 404 });
      }
      throw error;
    }
  }

  // Path D (Sprint-011): a `documentId` request carries no claim/source of
  // its own either — `claim` is the user-selected excerpt, resolved and
  // verified against the Document's content inside the service, not here.
  const documentId = body?.documentId;
  if (documentId !== undefined) {
    if (typeof documentId !== "string" || documentId.trim().length === 0) {
      return NextResponse.json({ error: "documentId must be a non-empty string" }, { status: 400 });
    }
    const excerpt = body?.excerpt;
    if (typeof excerpt !== "string") {
      return NextResponse.json({ error: "excerpt must be a string" }, { status: 400 });
    }
    try {
      const evidence = await evidenceService.addEvidenceFromDocument(userId, decisionId, documentId.trim(), excerpt);
      return NextResponse.json(evidence, { status: 201 });
    } catch (error) {
      if (error instanceof evidenceService.DecisionNotFoundError) {
        return NextResponse.json({ error: "Decision not found" }, { status: 404 });
      }
      if (error instanceof evidenceService.DocumentNotFoundError) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
      }
      if (error instanceof evidenceService.InvalidEvidenceInputError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
  }

  // Path E (Sprint-016): a `calendarEventId` request carries no claim/source
  // of its own either — `claim` is derived server-side from a fresh
  // `read_calendar` re-fetch, never from anything the client supplies.
  const calendarEventId = body?.calendarEventId;
  if (calendarEventId !== undefined) {
    if (typeof calendarEventId !== "string" || calendarEventId.trim().length === 0) {
      return NextResponse.json({ error: "calendarEventId must be a non-empty string" }, { status: 400 });
    }
    try {
      const evidence = await evidenceService.addEvidenceFromCalendarEvent(
        userId,
        decisionId,
        calendarEventId.trim(),
      );
      return NextResponse.json(evidence, { status: 201 });
    } catch (error) {
      if (error instanceof evidenceService.DecisionNotFoundError) {
        return NextResponse.json({ error: "Decision not found" }, { status: 404 });
      }
      if (error instanceof evidenceService.CalendarEventNotFoundError) {
        return NextResponse.json({ error: "Calendar event not found" }, { status: 404 });
      }
      if (error instanceof evidenceService.CalendarProviderUnavailableError) {
        return NextResponse.json({ error: "Calendar is currently unavailable" }, { status: 502 });
      }
      throw error;
    }
  }

  const claim = body?.claim;
  const source = body?.source;

  if (typeof claim !== "string" || claim.trim().length === 0) {
    return NextResponse.json({ error: "claim is required" }, { status: 400 });
  }
  if (typeof source !== "string" || source.trim().length === 0) {
    return NextResponse.json({ error: "source is required" }, { status: 400 });
  }

  const value = parseOptionalNumber(body?.value);
  if (!value.ok) return NextResponse.json({ error: "value must be a number" }, { status: 400 });

  const currency = parseOptionalString(body?.currency);
  if (!currency.ok) return NextResponse.json({ error: "currency must be a string" }, { status: 400 });

  const measure = parseOptionalString(body?.measure);
  if (!measure.ok) return NextResponse.json({ error: "measure must be a string" }, { status: 400 });

  const observedAt = parseOptionalString(body?.observedAt);
  if (!observedAt.ok) return NextResponse.json({ error: "observedAt must be a string" }, { status: 400 });

  const optionLabel = parseOptionalString(body?.optionLabel);
  if (!optionLabel.ok) return NextResponse.json({ error: "optionLabel must be a string" }, { status: 400 });

  const input: AddEvidenceInput = {
    claim: claim.trim(),
    source: source.trim(),
    value: value.value,
    currency: currency.value,
    measure: measure.value,
    observedAt: observedAt.value,
    optionLabel: optionLabel.value,
  };

  try {
    const evidence = await evidenceService.addEvidence(userId, decisionId, input);
    return NextResponse.json(evidence, { status: 201 });
  } catch (error) {
    if (error instanceof evidenceService.DecisionNotFoundError) {
      return NextResponse.json({ error: "Decision not found" }, { status: 404 });
    }
    if (error instanceof evidenceService.InvalidEvidenceInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
