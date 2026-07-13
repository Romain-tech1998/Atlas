import type { EvidenceItem } from "@/domain/decision";

/**
 * RFC-0001 §4 "Evidence Normalization" (Sprint-005). The deliberately
 * minimal set of structured shapes a normalized value can take. Boolean is
 * intentionally omitted — nothing in this sprint needs it, and adding it
 * without a concrete case would be filling out the list for its own sake.
 */
export const NORMALIZED_VALUE_KINDS = ["numeric", "currency", "date", "user_provided"] as const;
export type NormalizedValueKind = (typeof NORMALIZED_VALUE_KINDS)[number];

/**
 * RFC-0001 §4 "Measure" (Sprint-007). A small, fixed vocabulary describing
 * what a `numeric`/`currency` value represents — the missing piece that let
 * Sprint-006's `find_lowest_value` compare a product's price against a
 * user's stated budget just because both were `currency`/`CAD`. Extend only
 * when a concrete case needs a new one, never speculatively — the same
 * discipline Sprint-005 used to leave `boolean` out of NormalizedValueKind.
 *
 * Deliberately has no `"unknown"` member: a value with no recognized
 * measure simply omits the field. "Unknown" is not itself a measure two
 * values can share (see `find_lowest_value`'s hard rule) — encoding it as a
 * literal would invite treating it like one.
 */
export const NORMALIZED_MEASURES = [
  "price",
  "budget",
  "rent",
  "salary",
  "rating",
  "quality",
  "brand_score",
  "duration",
] as const;
export type NormalizedMeasure = (typeof NORMALIZED_MEASURES)[number];

/** RFC-0003 §7a: whether a lower or higher raw value is "better" for this
 * measure — needed only by `compare_options`' multi-criteria scoring;
 * `find_lowest_value` has no use for this (it always means "lowest," by
 * definition, for whichever single measure it's given). */
export const MEASURE_DIRECTION: Record<NormalizedMeasure, "lower_is_better" | "higher_is_better"> = {
  price: "lower_is_better",
  budget: "lower_is_better",
  rent: "lower_is_better",
  salary: "higher_is_better",
  rating: "higher_is_better",
  quality: "higher_is_better",
  brand_score: "higher_is_better",
  duration: "lower_is_better",
};

interface NormalizedValueBase {
  /** The one Evidence this value was derived from — never more than one, by
   * construction (RFC-0001 §4 traceability: normalization is derived, not a
   * separate record that could drift from its source). */
  evidenceId: string;
  /** Threaded straight from the source Evidence so future reasoning can see
   * when the underlying fact was true, without a separate freshness score. */
  observedAt: string;
}

export interface NormalizedNumericValue extends NormalizedValueBase {
  kind: "numeric";
  value: number;
  /** Absent means "unknown" — never inferred, never guessed. */
  measure?: NormalizedMeasure;
}

export interface NormalizedCurrencyValue extends NormalizedValueBase {
  kind: "currency";
  value: number;
  currency: string;
  /** Absent means "unknown" — never inferred, never guessed. */
  measure?: NormalizedMeasure;
}

export interface NormalizedDateValue extends NormalizedValueBase {
  kind: "date";
  value: string;
}

/** Catch-all for a claim that can't be confidently parsed into a typed kind.
 * Not a failure state — per RFC-0001 §4's "never guess" rule, staying
 * unstructured is exactly as valid an outcome as parsing successfully. */
export interface NormalizedUserProvidedValue extends NormalizedValueBase {
  kind: "user_provided";
  value: string;
}

export type NormalizedValue =
  | NormalizedNumericValue
  | NormalizedCurrencyValue
  | NormalizedDateValue
  | NormalizedUserProvidedValue;

// A small curated set for deterministic parsing — not exhaustive ISO 4217.
// Widening this list is safe and non-breaking; it only affects which claims
// are recognized, never how a recognized one is shaped.
const CURRENCY_CODES = [
  "USD",
  "CAD",
  "EUR",
  "GBP",
  "JPY",
  "AUD",
  "CHF",
  "CNY",
  "INR",
  "MXN",
  "NZD",
  "SEK",
  "NOK",
  "DKK",
  "BRL",
  "ZAR",
] as const;
const CURRENCY_SYMBOLS: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP", "¥": "JPY" };

const NUMBER_PATTERN = "\\d[\\d,]*(?:\\.\\d+)?";
const CODE_ALTERNATION = CURRENCY_CODES.join("|");

const CODE_THEN_NUMBER = new RegExp(`\\b(${CODE_ALTERNATION})\\s?(${NUMBER_PATTERN})\\b`);
const NUMBER_THEN_CODE = new RegExp(`\\b(${NUMBER_PATTERN})\\s?(${CODE_ALTERNATION})\\b`);
const SYMBOL_THEN_NUMBER = new RegExp(`([$€£¥])\\s?(${NUMBER_PATTERN})`);
const ISO_DATE = /\b(\d{4}-\d{2}-\d{2})\b/;

function parseAmount(raw: string): number {
  return Number.parseFloat(raw.replace(/,/g, ""));
}

/** Only fires on an explicit currency code or symbol next to a number —
 * never guesses that a bare number is a price. */
function extractCurrencyFromClaim(claim: string): { value: number; currency: string } | null {
  const codeThenNumber = claim.match(CODE_THEN_NUMBER);
  if (codeThenNumber) return { value: parseAmount(codeThenNumber[2]), currency: codeThenNumber[1] };

  const numberThenCode = claim.match(NUMBER_THEN_CODE);
  if (numberThenCode) return { value: parseAmount(numberThenCode[1]), currency: numberThenCode[2] };

  const symbolThenNumber = claim.match(SYMBOL_THEN_NUMBER);
  if (symbolThenNumber) {
    return { value: parseAmount(symbolThenNumber[2]), currency: CURRENCY_SYMBOLS[symbolThenNumber[1]] };
  }

  return null;
}

/** Only an explicit ISO 8601 date (YYYY-MM-DD) counts — anything looser
 * ("next Friday", "in two weeks") is language, not parsing, and is out of
 * scope (RFC-0001 §4: no NLP, never guess). Exported (Sprint-008) so
 * structured-input validation can reuse this exact check for `observedAt`
 * instead of writing a second date validator. */
export function extractDateFromClaim(claim: string): string | null {
  const match = claim.match(ISO_DATE);
  if (!match) return null;
  return Number.isNaN(Date.parse(match[1])) ? null : match[1];
}

// RFC-0001 §4 "Measure" (Sprint-007): a tiny, hardcoded, case-insensitive
// keyword set — the same "obvious pattern only" discipline as the
// currency/date regexes above. Checked in order; the first match wins. Never
// expand this beyond the five measures NORMALIZED_MEASURES covers.
const MEASURE_KEYWORDS: ReadonlyArray<{ pattern: RegExp; measure: NormalizedMeasure }> = [
  { pattern: /\bcosts?\b|\bprice is\b/i, measure: "price" },
  { pattern: /\bbudget is\b/i, measure: "budget" },
  { pattern: /\brent is\b/i, measure: "rent" },
  { pattern: /\bsalary is\b/i, measure: "salary" },
  { pattern: /\brating is\b|\brated\b/i, measure: "rating" },
  { pattern: /\bquality is\b/i, measure: "quality" },
  { pattern: /\bbrand score is\b/i, measure: "brand_score" },
  { pattern: /\bduration is\b|\btakes\b/i, measure: "duration" },
];

/** Only fires on one of the obvious keyword phrases above — if none match,
 * returns undefined ("unknown"), never a guess. */
function extractMeasureFromClaim(claim: string): NormalizedMeasure | undefined {
  return MEASURE_KEYWORDS.find(({ pattern }) => pattern.test(claim))?.measure;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Reads `metadata.measure` only when it's one of the five recognized
 * values (case-insensitively) — any other value (typo, unrecognized term,
 * wrong type) is treated the same as absent: "unknown", never guessed at. */
function extractMeasureFromMetadata(metadata: Record<string, unknown>): NormalizedMeasure | undefined {
  const raw = metadata.measure;
  if (typeof raw !== "string") return undefined;
  const normalized = raw.trim().toLowerCase();
  return (NORMALIZED_MEASURES as readonly string[]).includes(normalized) ? (normalized as NormalizedMeasure) : undefined;
}

type MetadataShape =
  | { kind: "numeric"; value: number; measure?: NormalizedMeasure }
  | { kind: "currency"; value: number; currency: string; measure?: NormalizedMeasure }
  | { kind: "date"; value: string };

/** Reads Evidence.metadata's known shapes only (e.g. `{ price, currency,
 * measure }`, `{ value, measure }`, `{ date }`) — never guesses at
 * unfamiliar keys. Returns an empty array (not a throw) for anything else,
 * so the caller falls back to parsing `claim` instead. */
function extractFromMetadata(metadata: Record<string, unknown>): MetadataShape[] {
  const values: MetadataShape[] = [];
  const measure = extractMeasureFromMetadata(metadata);

  const amount = metadata.price ?? metadata.value;
  const currency = metadata.currency;
  if (isFiniteNumber(amount) && typeof currency === "string" && currency.trim().length > 0) {
    values.push({ kind: "currency", value: amount, currency: currency.trim().toUpperCase(), ...(measure ? { measure } : {}) });
  } else if (isFiniteNumber(amount)) {
    values.push({ kind: "numeric", value: amount, ...(measure ? { measure } : {}) });
  }

  if (typeof metadata.date === "string" && !Number.isNaN(Date.parse(metadata.date))) {
    values.push({ kind: "date", value: metadata.date });
  }

  return values;
}

/**
 * Pure, deterministic derivation of zero or more structured values from one
 * Evidence item (RFC-0001 §4 "Evidence Normalization"). Never edits or
 * re-persists Evidence — this is computed on read, not a new stored record.
 * Every returned value carries the source Evidence's `id`/`observedAt`
 * alongside its parsed shape, so tracing a normalized value back to its
 * Evidence is trivial by construction.
 *
 * Order of preference: `metadata` (when present and shaped usably) first,
 * since it's already structured; a hardcoded currency/date pattern over
 * `claim` next; and a `user_provided` catch-all when neither applies. Never
 * throws — malformed/unrecognized metadata just falls through to the next
 * step rather than failing.
 *
 * `numeric`/`currency` values also carry an optional `measure` (RFC-0001 §4
 * "Measure", Sprint-007) when one is recognized from `metadata.measure` or
 * an obvious claim keyword ("costs" → price, etc.) — absent otherwise,
 * meaning "unknown", never guessed.
 */
export function normalizeEvidence(evidence: EvidenceItem): NormalizedValue[] {
  const { id: evidenceId, observedAt, claim, metadata } = evidence;

  if (isPlainObject(metadata)) {
    const fromMetadata = extractFromMetadata(metadata);
    if (fromMetadata.length > 0) {
      return fromMetadata.map((partial) => ({ ...partial, evidenceId, observedAt }) as NormalizedValue);
    }
  }

  const values: NormalizedValue[] = [];

  const currency = extractCurrencyFromClaim(claim);
  if (currency) {
    const measure = extractMeasureFromClaim(claim);
    values.push({ kind: "currency", evidenceId, observedAt, ...currency, ...(measure ? { measure } : {}) });
  }

  const date = extractDateFromClaim(claim);
  if (date) values.push({ kind: "date", evidenceId, observedAt, value: date });

  if (values.length > 0) return values;

  return [{ kind: "user_provided", evidenceId, observedAt, value: claim }];
}
