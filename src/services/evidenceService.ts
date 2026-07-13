import { evidenceRepository, type EvidenceRow } from "@/services/evidenceRepository";
import { verdictRepository, type VerdictRow } from "@/services/verdictRepository";
import { decisionRepository } from "@/services/decisionRepository";
import { learningRepository } from "@/brain/learning/learningRepository";
import { memoryRepository, type MemoryRow, type ListMemoriesOptions } from "@/brain/memory/memoryRepository";
import { documentRepository, type DocumentRow, type ListDocumentsOptions } from "@/services/documentRepository";
import { computeEvidenceCoverage } from "@/domain/decision";
import type { EvidenceItem, VerdictSummary } from "@/domain/decision";
import { normalizeEvidence, extractDateFromClaim, NORMALIZED_MEASURES } from "@/domain/evidence-normalization";
import { runSkill } from "@/skills/skillEngine";
import { findLowestValueSkill, type ComparableValue } from "@/skills/find-lowest-value";
import { compareOptionsSkill, type ComparableOptionValue } from "@/skills/compare-options";
import { createReadCalendarSkill } from "@/skills/read-calendar";
import { createGoogleCalendarProvider } from "@/providers/google-calendar-provider";
import { localized } from "@/i18n/message";

class DecisionNotFoundError extends Error {
  constructor() {
    super("Decision not found");
  }
}

/** Thrown for structured Evidence input that fails validation (Sprint-008)
 * — never for a missing/blank `measure`, which is a valid "unknown" state,
 * not an error (RFC-0001 §4). */
class InvalidEvidenceInputError extends Error {}

/** Thrown by Path C (Sprint-009) when the given `memoryId` doesn't exist or
 * doesn't belong to this user — same ownership-check convention as
 * `DecisionNotFoundError`. */
class MemoryNotFoundError extends Error {
  constructor() {
    super("Memory not found");
  }
}

/** Thrown by Path D (Sprint-011) when the given `documentId` doesn't exist
 * or doesn't belong to this user — same ownership-check convention as
 * `DecisionNotFoundError`/`MemoryNotFoundError`. */
class DocumentNotFoundError extends Error {
  constructor() {
    super("Document not found");
  }
}

/** Thrown by Path E (Sprint-016) when the fresh `read_calendar` re-fetch
 * (RFC-0001 §4 "Calendar Event Evidence") doesn't contain the given
 * `calendarEventId` — the event may have been deleted/moved on Google's
 * side, or the id was stale. Distinct from `CalendarProviderUnavailableError`
 * below: this means the re-fetch succeeded but that specific event isn't in
 * it, not that Atlas couldn't ask Google at all. */
class CalendarEventNotFoundError extends Error {
  constructor() {
    super("Calendar event not found");
  }
}

/** Thrown by Path E (Sprint-016) when `read_calendar`'s re-fetch itself
 * fails (`ReadCalendarFailure` — disconnected, revoked, or a transient
 * Google API failure) — Atlas couldn't ask Google at all, as opposed to
 * `CalendarEventNotFoundError`'s "asked, but this id isn't there." */
class CalendarProviderUnavailableError extends Error {
  constructor() {
    super("Calendar provider unavailable");
  }
}

/**
 * The input to `addEvidence` (Sprint-008, extended Sprint-009). `claim`/
 * `source` are Path A's free-text minimum, unchanged since Sprint-004.
 * `value`/`currency`/`measure`/`observedAt` are Path B's optional
 * structured fields — present or absent independently, never required.
 * `sourceMemoryId` is Path C's traceability field (Sprint-009), set only by
 * `addEvidenceFromMemory` below — never by a direct caller. All three paths
 * flow through the exact same function below; only which of these fields
 * get populated, and how, differs between them.
 */
export interface AddEvidenceInput {
  claim: string;
  source: string;
  /** Optional structured value. Maps to `Evidence.metadata.value` — the
   * same key `normalizeEvidence`'s `extractFromMetadata` already reads. */
  value?: number;
  /** Maps to `Evidence.metadata.currency`. Only meaningful alongside `value`. */
  currency?: string;
  /** Maps to `Evidence.metadata.measure`. Blank/absent means "unknown" — a
   * valid state, not an error. Only meaningful alongside `value`. */
  measure?: string;
  /**
   * ISO 8601 date (YYYY-MM-DD) for user-typed structured input (Path B) —
   * validated below. Defaults to "now" when absent, same as every Evidence
   * before Sprint-008. Also accepts a `Date` directly (Sprint-009, Path C:
   * `Memory.createdAt`) — never validated as a string, since it never came
   * from raw user text; it's already a trusted value from Atlas's own
   * database, preserving the Memory's original full timestamp rather than
   * truncating it to fit the date-only structured-input shape.
   */
  observedAt?: string | Date;
  /** Maps to `Evidence.metadata.sourceMemoryId` (Sprint-009) — traces this
   * Evidence back to the Memory it was created from. Set only by
   * `addEvidenceFromMemory`. */
  sourceMemoryId?: string;
  /** Maps to `Evidence.metadata.sourceDocumentId` (Sprint-011) — traces
   * this Evidence back to the Document its excerpt came from. Set only by
   * `addEvidenceFromDocument`. */
  sourceDocumentId?: string;
  /** Maps to `Evidence.metadata.sourceDocumentTitle` (Sprint-011) — a
   * snapshot of the Document's title *at attachment time*. Denormalized on
   * purpose: Evidence must stay understandable even if the Document is
   * later renamed or deleted (neither is built yet, but the Evidence model
   * shouldn't assume they never will be — RFC-0001 §4). Set only by
   * `addEvidenceFromDocument`. */
  sourceDocumentTitle?: string;
  /** Maps to `Evidence.metadata.calendarEventId` (Sprint-016, Path E) —
   * traces this Evidence back to the Google Calendar event it was created
   * from. Set only by `addEvidenceFromCalendarEvent`. */
  calendarEventId?: string;
  /** Maps to `Evidence.metadata.calendarEventTitle` (Sprint-016) — a
   * snapshot of the event's title at attachment time, same denormalization
   * reasoning as `sourceDocumentTitle`: the source event can change or be
   * deleted on Google's side without affecting this Evidence's readability.
   * Set only by `addEvidenceFromCalendarEvent`. */
  calendarEventTitle?: string;
  /** Maps to `Evidence.metadata.optionLabel` (Sprint-030, RFC-0003 §7a) —
   * which named option this Evidence describes (e.g. "Nike Crew Neck").
   * Free text, denormalized, same pattern as `sourceDocumentTitle` — no new
   * table, no foreign key. Evidence with no `optionLabel` is simply not
   * eligible for `compare_options` grouping; it doesn't error or get
   * rejected. */
  optionLabel?: string;
}

/**
 * Server-side gate for structured input (RFC-0001 §4 "Structured Evidence
 * input") — the actual guarantee; any client-side form validation is a UX
 * nicety on top of this, never a substitute for it. Never silently
 * corrects input (e.g. no auto-trim-and-accept of a bad measure) — every
 * rule here either passes the input through untouched or rejects it with a
 * specific reason.
 */
function validateStructuredInput(input: AddEvidenceInput): void {
  if (input.currency !== undefined && input.value === undefined) {
    throw new InvalidEvidenceInputError("currency requires a value");
  }
  if (input.measure !== undefined && input.value === undefined) {
    throw new InvalidEvidenceInputError("measure requires a value");
  }
  if (input.value !== undefined && input.value < 0) {
    throw new InvalidEvidenceInputError("value must not be negative");
  }
  if (input.measure !== undefined && !(NORMALIZED_MEASURES as readonly string[]).includes(input.measure)) {
    throw new InvalidEvidenceInputError(`measure must be one of: ${NORMALIZED_MEASURES.join(", ")}`);
  }
  if (typeof input.observedAt === "string") {
    // Reuses Sprint-005's exact ISO 8601 check rather than a second
    // validator — a full match (not just a substring) is required, since
    // this field is the whole date, not free text that might merely
    // contain one. A `Date` (Sprint-009, Path C) skips this entirely — it
    // never came from raw user text, so there's nothing to validate.
    const validated = extractDateFromClaim(input.observedAt);
    if (!validated || validated !== input.observedAt.trim()) {
      throw new InvalidEvidenceInputError("observedAt must be a valid date (YYYY-MM-DD)");
    }
  }
}

/** Maps Path B's structured fields, Path C's `sourceMemoryId` (Sprint-009),
 * Path D's `sourceDocumentId`/`sourceDocumentTitle` (Sprint-011), and Path
 * E's `calendarEventId`/`calendarEventTitle` (Sprint-016) onto
 * `Evidence.metadata`'s existing shape — exactly the key names
 * `extractFromMetadata`/`extractMeasureFromMetadata` already read for
 * `value`/`currency`/`measure`; the `source*`/`calendar*` keys are new but
 * still no schema change, same metadata-reuse precedent as every sprint
 * since Sprint-005. `sourceProvider`/`calendarCalendarId` are fixed literals
 * (RFC-0001 §4 "Calendar Event Evidence") — there's only one Provider and
 * one calendar in this sprint's scope, so these aren't configurable. Returns
 * undefined (not `{}`) when nothing structured was provided, so Path A
 * Evidence keeps writing a null `metadata` column exactly as before. */
function buildMetadata(input: AddEvidenceInput): Record<string, string | number> | undefined {
  const metadata: Record<string, string | number> = {};
  if (input.value !== undefined) metadata.value = input.value;
  if (input.currency !== undefined) metadata.currency = input.currency;
  if (input.measure !== undefined) metadata.measure = input.measure;
  if (input.sourceMemoryId !== undefined) metadata.sourceMemoryId = input.sourceMemoryId;
  if (input.sourceDocumentId !== undefined) metadata.sourceDocumentId = input.sourceDocumentId;
  if (input.sourceDocumentTitle !== undefined) metadata.sourceDocumentTitle = input.sourceDocumentTitle;
  if (input.calendarEventId !== undefined) {
    metadata.calendarEventId = input.calendarEventId;
    metadata.sourceProvider = "google_calendar";
    metadata.calendarCalendarId = "primary";
  }
  if (input.calendarEventTitle !== undefined) metadata.calendarEventTitle = input.calendarEventTitle;
  if (input.optionLabel !== undefined) metadata.optionLabel = input.optionLabel;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function toEvidenceItem(row: EvidenceRow): EvidenceItem {
  return {
    id: row.id,
    claim: row.claim,
    source: row.source,
    observedAt: row.observedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    metadata: row.metadata,
  };
}

function buildVerdictSummary(verdict: VerdictRow, evidenceCount: number): VerdictSummary {
  return {
    status: verdict.status,
    recommendation: verdict.recommendation,
    reasoning: verdict.reasoning,
    evidenceCoverage: verdict.evidenceCoverage,
    evidenceCount,
    comparedEvidenceIds: verdict.comparedEvidenceIds,
    ranking: verdict.ranking,
  };
}

/** Only `numeric`/`currency` normalized values are comparable
 * (`find_lowest_value`'s input shape, RFC-0003 §9) — `date` and
 * `user_provided` are dropped here rather than passed in and rejected
 * downstream, keeping the Skill itself free of any "which kinds are
 * comparable" filtering logic that belongs to this call site instead. */
function toComparableValue(value: ReturnType<typeof normalizeEvidence>[number]): ComparableValue | null {
  if (value.kind === "numeric") {
    return { evidenceId: value.evidenceId, kind: "numeric", value: value.value, measure: value.measure };
  }
  if (value.kind === "currency") {
    return {
      evidenceId: value.evidenceId,
      kind: "currency",
      value: value.value,
      currency: value.currency,
      measure: value.measure,
    };
  }
  return null;
}

function extractOptionLabel(metadata: unknown): string | undefined {
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const raw = (metadata as Record<string, unknown>).optionLabel;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
}

/** Only numeric/currency values with both a recognized `measure` and an
 * `optionLabel` are usable by `compare_options` — mirrors
 * `toComparableValue`'s kind-filtering, plus the new option-grouping
 * requirement `compare_options` itself declares as required input. */
function toComparableOptionValues(item: EvidenceItem): ComparableOptionValue[] {
  const optionLabel = extractOptionLabel(item.metadata);
  if (!optionLabel) return [];

  return normalizeEvidence(item).flatMap((value): ComparableOptionValue[] => {
    if (value.kind !== "numeric" && value.kind !== "currency") return [];
    if (value.measure === undefined) return [];
    if (value.kind === "numeric") {
      return [
        {
          evidenceId: value.evidenceId,
          optionLabel,
          kind: "numeric" as const,
          value: value.value,
          measure: value.measure,
          observedAt: value.observedAt,
        },
      ];
    }
    if (value.kind === "currency") {
      return [
        {
          evidenceId: value.evidenceId,
          optionLabel,
          kind: "currency" as const,
          value: value.value,
          currency: value.currency,
          measure: value.measure,
          observedAt: value.observedAt,
        },
      ];
    }
    return [];
  });
}

/**
 * Runs `find_lowest_value` (Sprint-006, RFC-0003 §8a/§9) or, since
 * Sprint-030, `compare_options` (RFC-0003 §7a/§9) over a Decision's current
 * Evidence and persists the result — the only place `VerdictStatus` ever
 * moves to `PRODUCED`. Recomputed and persisted on every `addEvidence` call
 * (same pattern as Sprint-004's `evidenceCoverage`): a Verdict already
 * `PRODUCED` can revert to `INSUFFICIENT_EVIDENCE` if newly-added Evidence
 * makes the comparison ambiguous again — this function never assumes a
 * Verdict only ever improves.
 */
async function recomputeVerdict(verdictId: string, evidenceRows: EvidenceRow[]): Promise<void> {
  const items = evidenceRows.map(toEvidenceItem);

  const optionValues = items.flatMap(toComparableOptionValues);
  const distinctOptions = new Set(optionValues.map((v) => v.optionLabel));

  // Branch: 2+ distinct named options with comparable Evidence means this
  // Decision is being worked as a multi-option comparison — compare_options
  // owns the Verdict entirely from here, exclusively (any unlabeled
  // Evidence on the same Decision is simply not counted, not merged in).
  // Fewer than 2 falls back to today's single-criterion find_lowest_value
  // path, completely unchanged below.
  if (distinctOptions.size >= 2) {
    const result = runSkill(compareOptionsSkill, { values: optionValues });

    if ("insufficientEvidence" in result) {
      await verdictRepository.setVerdictResult(verdictId, {
        status: "INSUFFICIENT_EVIDENCE",
        recommendation: null,
        reasoning: null,
        comparedEvidenceIds: null,
        ranking: null,
      });
      return;
    }

    const winner = result.ranking[0];
    await verdictRepository.setVerdictResult(verdictId, {
      status: "PRODUCED",
      recommendation: localized("verdict.compareOptions.recommendation", { optionLabel: winner.optionLabel }),
      reasoning: localized("verdict.compareOptions.reasoning", { count: result.ranking.length }),
      comparedEvidenceIds: result.ranking.flatMap((r) => r.comparedEvidenceIds),
      ranking: result.ranking.map((r) => ({ optionLabel: r.optionLabel, score: r.score })),
    });
    return;
  }

  const comparableValues = items
    .flatMap((item) => normalizeEvidence(item))
    .map(toComparableValue)
    .filter((value): value is ComparableValue => value !== null);

  const result = runSkill(findLowestValueSkill, { values: comparableValues });

  if ("insufficientEvidence" in result) {
    await verdictRepository.setVerdictResult(verdictId, {
      status: "INSUFFICIENT_EVIDENCE",
      recommendation: null,
      reasoning: null,
      comparedEvidenceIds: null,
      ranking: null,
    });
    return;
  }

  // Safe: `result.evidenceId` is always one of `comparableValues`' own ids —
  // the Skill never invents an id it wasn't given.
  const winningValue = comparableValues.find((value) => value.evidenceId === result.evidenceId)!;
  const winningEvidence = items.find((item) => item.id === result.evidenceId)!;

  const recommendation =
    winningValue.kind === "currency" && winningValue.currency
      ? localized("verdict.findLowestValue.recommendationCurrency", {
          claim: winningEvidence.claim,
          value: winningValue.value,
          currency: winningValue.currency,
        })
      : localized("verdict.findLowestValue.recommendationNumeric", {
          claim: winningEvidence.claim,
          value: winningValue.value,
        });

  const reasoning = localized("verdict.findLowestValue.reasoning", {
    count: result.comparedEvidenceIds.length,
  });

  await verdictRepository.setVerdictResult(verdictId, {
    status: "PRODUCED",
    recommendation,
    reasoning,
    comparedEvidenceIds: result.comparedEvidenceIds,
    ranking: null,
  });
}

/** Returns the Decision's Verdict, creating one if this Decision predates
 * Verdict (Sprint-003 and earlier) — same self-healing pattern as
 * `decisionService.ensureDecisionForMission`. Every Decision from
 * Sprint-004 onward already has one, created atomically alongside it. */
async function ensureVerdictForDecision(userId: string, decisionId: string): Promise<VerdictRow> {
  const existing = await verdictRepository.getVerdictForDecision(userId, decisionId);
  if (existing) return existing;
  return verdictRepository.createVerdict(userId, decisionId);
}

async function getEvidenceAndVerdict(
  userId: string,
  decisionId: string,
): Promise<{ evidence: EvidenceItem[]; verdict: VerdictSummary }> {
  const [evidenceRows, verdict] = await Promise.all([
    evidenceRepository.getEvidenceForDecision(userId, decisionId),
    ensureVerdictForDecision(userId, decisionId),
  ]);

  return { evidence: evidenceRows.map(toEvidenceItem), verdict: buildVerdictSummary(verdict, evidenceRows.length) };
}

/**
 * Records a new Evidence item against a Decision, recomputes its Verdict's
 * `evidenceCoverage` from the new count (see `computeEvidenceCoverage` — a
 * quantity placeholder, never a confidence score), and (Sprint-006) runs
 * `find_lowest_value` over the Decision's current normalized Evidence to
 * recompute `VerdictStatus` itself. Adding one more fact only moves the
 * Verdict to `PRODUCED` if that fact makes a real, unambiguous comparison
 * possible — never a guess, and never just because Evidence exists.
 *
 * One shared path for both free-text Evidence (`input.value`/`currency`/
 * `measure` all absent) and structured Evidence (Sprint-008, some or all of
 * them present) — only `input`'s construction differs between the two
 * callers (the form's free-text-only submission vs. its structured panel);
 * persistence, validation, and Verdict recomputation are identical either
 * way, by construction.
 */
async function addEvidence(userId: string, decisionId: string, input: AddEvidenceInput): Promise<EvidenceItem> {
  const decision = await decisionRepository.getDecisionById(userId, decisionId);
  if (!decision) throw new DecisionNotFoundError();

  validateStructuredInput(input);

  const verdict = await ensureVerdictForDecision(userId, decisionId);
  const observedAt = input.observedAt
    ? input.observedAt instanceof Date
      ? input.observedAt
      : new Date(input.observedAt)
    : new Date();
  const row = await evidenceRepository.createEvidence(
    userId,
    decisionId,
    input.claim,
    input.source,
    observedAt,
    buildMetadata(input),
  );
  const evidenceRows = await evidenceRepository.getEvidenceForDecision(userId, decisionId);

  await verdictRepository.setEvidenceCoverage(verdict.id, computeEvidenceCoverage(evidenceRows.length));
  await recomputeVerdict(verdict.id, evidenceRows);

  await learningRepository.saveSignals(userId, null, [
    { type: "evidence_added", payload: { decisionId, evidenceCount: evidenceRows.length } },
  ]);

  return toEvidenceItem(row);
}

/**
 * Path C (Sprint-009, RFC-0001 §4 "Evidence acquisition — internal sources
 * first"). Creates Evidence from one of the user's own Memory entries — an
 * explicit, visible user gesture (the caller already had the user pick this
 * exact `memoryId`), never automatic, and not a Skill or Provider: Memory
 * is the user's own data already inside Atlas, crossing no new trust
 * boundary. Funnels through the exact same `addEvidence` validation and
 * persistence as Path A/B; only the input's construction differs.
 *
 * `claim` is the Memory's `content` verbatim — never summarized,
 * truncated, or rewritten (this sprint has no intelligence to shorten a
 * fact without risking distortion). `source` is the fixed string
 * `"memory"`, consistent with existing short-source convention
 * (`"user"`, `"rbc.com"`). `observedAt` is the Memory's own `createdAt` —
 * when the fact was originally captured, not "now" — so a Memory attached
 * today still carries its true original observation date.
 */
async function addEvidenceFromMemory(userId: string, decisionId: string, memoryId: string): Promise<EvidenceItem> {
  const memory = await memoryRepository.getMemoryById(userId, memoryId);
  if (!memory) throw new MemoryNotFoundError();

  return addEvidence(userId, decisionId, {
    claim: memory.content,
    source: "memory",
    observedAt: memory.createdAt,
    sourceMemoryId: memory.id,
  });
}

/** Sprint-012: the shape both internal Evidence sources' browsers consume
 * — a page of results plus whether another page exists (see
 * `memoryRepository.MemoryPage`/`documentRepository.DocumentPage`, which
 * this simply re-shapes per source). */
export interface InternalEvidencePage<T> {
  items: T[];
  hasMore: boolean;
}

export interface AttachableMemory {
  id: string;
  content: string;
  observedAt: string;
}

function toAttachableMemory(row: MemoryRow): AttachableMemory {
  return { id: row.id, content: row.content, observedAt: row.createdAt.toISOString() };
}

/** The user's Memory entries, shaped for the Evidence-from-Memory picker
 * (Sprint-009), optionally filtered/paginated (Sprint-012, see
 * `memoryRepository.listMemories` for the actual filtering rules) — still
 * just a plain, unranked list for the user to browse and pick from
 * themselves. */
async function listMemoriesForEvidence(
  userId: string,
  options: ListMemoriesOptions = {},
): Promise<InternalEvidencePage<AttachableMemory>> {
  const { items, hasMore } = await memoryRepository.listMemories(userId, options);
  return { items: items.map(toAttachableMemory), hasMore };
}

// A generous ceiling, not a smart heuristic (RFC-0001 §4): ~500 characters
// is a few sentences — comfortably enough for one genuine excerpt — while
// still clearly rejecting an accidental whole-paragraph/whole-document
// paste. It's a blunt shape guard, not a judgment about what a "real" fact
// looks like.
const MAX_EXCERPT_LENGTH = 500;

/**
 * Path D's excerpt gate (Sprint-011). Order matters, per RFC-0001 §4: trim
 * first (the same incidental-whitespace-only trim every other Evidence
 * path already applies to `claim`, e.g. `claim.trim()` since Sprint-004/008
 * — never a content rewrite), *then* check the trimmed excerpt appears
 * verbatim in the Document's content, *then* the trimmed string becomes
 * `claim`. The verbatim check is an exact, case-sensitive substring match
 * — no fuzzy matching, no whitespace collapsing beyond that one trim. This
 * is the only gate; there's no fallback to the whole Document and no
 * fabricated excerpt if the check fails.
 */
function validateExcerpt(excerpt: string, documentContent: string): string {
  const trimmed = excerpt.trim();
  if (trimmed.length === 0) {
    throw new InvalidEvidenceInputError("excerpt must not be empty");
  }
  if (trimmed.length > MAX_EXCERPT_LENGTH) {
    throw new InvalidEvidenceInputError(`excerpt must be at most ${MAX_EXCERPT_LENGTH} characters`);
  }
  if (!documentContent.includes(trimmed)) {
    throw new InvalidEvidenceInputError("excerpt must appear verbatim in the document's content");
  }
  return trimmed;
}

/**
 * Path D (Sprint-011, RFC-0001 §4 "Document-sourced Evidence"). Creates
 * Evidence from a user-selected excerpt of one of their own Documents — an
 * explicit, visible user gesture (the caller already had the user pick this
 * exact `documentId` and type/paste this exact `excerpt`), never automatic,
 * and not a Skill or Provider, same reasoning as Path C: a Document is the
 * user's own data already inside Atlas. Funnels through the exact same
 * `addEvidence` validation and persistence as every other path; only the
 * input's construction differs.
 *
 * `claim` is the trimmed excerpt — never the whole Document, never
 * rewritten, never chosen by Atlas (see `validateExcerpt`). `source` is the
 * fixed string `"document"`. `observedAt` is the Document's own
 * `createdAt` — when the underlying content was originally saved, not
 * "now". `sourceDocumentTitle` is a snapshot of the title at attachment
 * time, so the Evidence stays understandable even if the Document is later
 * renamed or deleted.
 */
async function addEvidenceFromDocument(
  userId: string,
  decisionId: string,
  documentId: string,
  excerpt: string,
): Promise<EvidenceItem> {
  const document = await documentRepository.getDocumentById(userId, documentId);
  if (!document) throw new DocumentNotFoundError();

  const claim = validateExcerpt(excerpt, document.content);

  return addEvidence(userId, decisionId, {
    claim,
    source: "document",
    observedAt: document.createdAt,
    sourceDocumentId: document.id,
    sourceDocumentTitle: document.title,
  });
}

export interface AttachableDocument {
  id: string;
  title: string;
  content: string;
  observedAt: string;
}

function toAttachableDocument(row: DocumentRow): AttachableDocument {
  return { id: row.id, title: row.title, content: row.content, observedAt: row.createdAt.toISOString() };
}

/** The user's Documents, shaped for the Evidence-from-Document picker
 * (Sprint-011), optionally filtered/paginated (Sprint-012, see
 * `documentRepository.listDocuments` for the actual filtering rules) —
 * full `content` included so the user can read it and choose their own
 * excerpt; still no ranking. */
async function listDocumentsForEvidence(
  userId: string,
  options: ListDocumentsOptions = {},
): Promise<InternalEvidencePage<AttachableDocument>> {
  const { items, hasMore } = await documentRepository.listDocuments(userId, options);
  return { items: items.map(toAttachableDocument), hasMore };
}

/** Deterministic, non-locale-formatted `YYYY-MM-DD` from a `CalendarEvent`'s
 * `start` — a fixed slice, never `toLocaleDateString` (locale-dependent, not
 * reproducible). Works for both an all-day event's date-only `start`
 * (already `YYYY-MM-DD`) and a timed event's full ISO datetime (its first
 * 10 characters are the same format). */
function calendarEventDatePart(start: string): string {
  return start.slice(0, 10);
}

/**
 * Path E (Sprint-016, RFC-0001 §4 "Calendar Event Evidence"). Creates
 * Evidence from one of the user's own upcoming Google Calendar events — an
 * explicit, visible user gesture (the caller already had the user pick this
 * exact `calendarEventId`), Atlas's first *external* Evidence source.
 *
 * The server re-resolves the event by id rather than trusting any
 * client-supplied event content: it calls `read_calendar` again itself
 * (fresh, so a stale client-held list can never smuggle in fabricated
 * `claim`/`observedAt` data) and looks up `calendarEventId` in that result.
 * This mirrors Path C/D's "server looks up by id, client never supplies
 * `claim` directly" discipline, and is stricter still since Calendar has no
 * persisted row to re-fetch by id the way Memory/Document do — the fresh
 * Provider call *is* the lookup.
 *
 * `claim` is deterministic: `"{title or fallback} — {YYYY-MM-DD}"`, e.g.
 * `"Vacation — 2026-08-05"` — never locale-formatted (see
 * `calendarEventDatePart`). A falsy `title` (Google can omit `summary`,
 * Sprint-015) becomes the fixed literal `"Untitled event"` — this is stored
 * data, not UI copy, so it's not run through i18n, same as every other
 * path's `claim` being stored verbatim in whatever language it was captured
 * in. `source` is the fixed string `"calendar"`. `observedAt` is
 * `new Date(event.start)`, unconditionally — never a string through
 * `validateStructuredInput`'s strict date-only check, which a timed event's
 * full ISO datetime would fail (same reasoning Memory/Document already
 * follow: a trusted value, not raw user text).
 */
async function addEvidenceFromCalendarEvent(
  userId: string,
  decisionId: string,
  calendarEventId: string,
): Promise<EvidenceItem> {
  const provider = createGoogleCalendarProvider(userId);
  const result = await runSkill(createReadCalendarSkill(provider), {});
  if ("error" in result) throw new CalendarProviderUnavailableError();

  const event = result.events.find((candidate) => candidate.id === calendarEventId);
  if (!event) throw new CalendarEventNotFoundError();

  const title = event.title || "Untitled event";
  const datePart = calendarEventDatePart(event.start);

  return addEvidence(userId, decisionId, {
    claim: `${title} — ${datePart}`,
    source: "calendar",
    observedAt: new Date(event.start),
    calendarEventId: event.id,
    calendarEventTitle: title,
  });
}

export const evidenceService = {
  getEvidenceAndVerdict,
  addEvidence,
  addEvidenceFromMemory,
  listMemoriesForEvidence,
  addEvidenceFromDocument,
  listDocumentsForEvidence,
  addEvidenceFromCalendarEvent,
  ensureVerdictForDecision,
  DecisionNotFoundError,
  InvalidEvidenceInputError,
  MemoryNotFoundError,
  DocumentNotFoundError,
  CalendarEventNotFoundError,
  CalendarProviderUnavailableError,
};
