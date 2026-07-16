import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { ProviderError } from "@/providers/provider";
import { NORMALIZED_MEASURES, type NormalizedMeasure } from "@/domain/evidence-normalization";
import type { AIProvider, MarketOption, MarketOptionValue } from "@/providers/ai-provider";

export const ANTHROPIC_AI_PROVIDER_ID = "anthropic_ai";

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ProviderError("unauthorized", "ANTHROPIC_API_KEY is not set.");
  return new Anthropic({ apiKey });
}

/** The structured-output schema handed to `output_config.format` — the
 * model's final text block is constrained to match this shape exactly, so
 * `JSON.parse`ing it never needs to tolerate markdown fences or prose
 * around the JSON the way an unconstrained chat completion would. */
const MARKET_OPTIONS_SCHEMA = {
  type: "object",
  properties: {
    options: {
      type: "array",
      items: {
        type: "object",
        properties: {
          optionLabel: { type: "string" },
          values: {
            type: "array",
            items: {
              type: "object",
              properties: {
                // Constrained to Atlas's own recognized vocabulary — the
                // model cannot invent a measure `evidenceService.addEvidence`
                // wouldn't accept. Belt-and-suspenders alongside
                // `toMarketOptionValue`'s own runtime check below, since a
                // model can occasionally deviate from a JSON schema even
                // when asked to conform to it.
                measure: { type: "string", enum: [...NORMALIZED_MEASURES] },
                value: { type: "number" },
                currency: { type: "string" },
                source: { type: "string" },
              },
              required: ["measure", "value", "source"],
              additionalProperties: false,
            },
          },
        },
        required: ["optionLabel", "values"],
        additionalProperties: false,
      },
    },
  },
  required: ["options"],
  additionalProperties: false,
} as const;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Same "drop anything malformed rather than throwing" discipline as
 * `verdictRepository.ts`'s `toRanking` — a value missing a required field
 * (measure/value/source) is dropped, not passed through as a fabricated
 * best-effort guess, and never causes the rest of a genuinely valid
 * response to be discarded. */
function isNormalizedMeasure(value: string): value is NormalizedMeasure {
  return (NORMALIZED_MEASURES as readonly string[]).includes(value);
}

function toMarketOptionValue(raw: unknown): MarketOptionValue | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { measure, value, currency, source } = raw as Record<string, unknown>;
  // Same recognized-vocabulary check `evidenceService.validateStructuredInput`
  // itself enforces — dropped here rather than passed through to fail
  // loudly inside `addEvidence` later, per this sprint's own "parse
  // defensively" instruction. The schema's `enum` (above) already asks the
  // model not to produce this, but a model can occasionally deviate from a
  // JSON schema even when asked to conform to it.
  if (typeof measure !== "string" || !isNormalizedMeasure(measure)) return null;
  if (!isFiniteNumber(value)) return null;
  if (typeof source !== "string" || source.trim().length === 0) return null;
  if (currency !== undefined && typeof currency !== "string") return null;
  return { measure, value, source, ...(currency ? { currency } : {}) };
}

function toMarketOption(raw: unknown): MarketOption | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { optionLabel, values } = raw as Record<string, unknown>;
  if (typeof optionLabel !== "string" || optionLabel.trim().length === 0) return null;
  if (!Array.isArray(values)) return null;
  const mappedValues = values.map(toMarketOptionValue).filter((v): v is MarketOptionValue => v !== null);
  // An option with zero surviving values contributes nothing comparable —
  // dropped entirely rather than kept as an empty, useless entry.
  if (mappedValues.length === 0) return null;
  return { optionLabel, values: mappedValues };
}

/** Pure parsing of the model's already-schema-constrained JSON output into
 * `MarketOption[]` — no network call, unit-testable against fixed fixture
 * JSON, same shape as `open-meteo-provider.ts`'s `mapOpenMeteoResponse`/
 * `mapGeocodingResponse`. Anything that isn't even the right top-level
 * shape (not an object, no `options` array) degrades to an empty array —
 * "found nothing groundable" and "response was malformed" collapse to the
 * same honest, non-fabricated outcome from this Skill's caller's point of
 * view. */
export function mapMarketOptionsResponse(raw: unknown): MarketOption[] {
  if (typeof raw !== "object" || raw === null) return [];
  const { options } = raw as Record<string, unknown>;
  if (!Array.isArray(options)) return [];
  return options.map(toMarketOption).filter((option): option is MarketOption => option !== null);
}

/** Sprint-036: no hardcoded ["price", "rating"] fallback — when the caller
 * has nothing to imply criteria from yet (a fresh Decision with no
 * Evidence), the model is asked to choose its own relevant criteria for
 * the subject, the same way it's already trusted to find and cite real
 * options, rather than this Provider guessing a module-aware default that
 * `Decision`'s deliberately module-less schema has no honest way to pick
 * (RFC-0003 §7a/§8h). Self-chosen criteria still only ever land as
 * `NORMALIZED_MEASURES` values — the JSON schema's `enum` and
 * `toMarketOptionValue`'s runtime check both already constrain this
 * unchanged, so an out-of-vocabulary self-chosen criterion is dropped the
 * same way an out-of-vocabulary value already was before this change. */
function buildPrompt(subject: string, criteria: string[]): string {
  const criteriaInstruction =
    criteria.length > 0
      ? `Score each option against these criteria: ${criteria.join(", ")}.`
      : "Decide which 2-4 criteria are most relevant for comparing options like this, and score each option against the criteria you choose.";
  return [
    `Find real, currently-available, named options for: "${subject}".`,
    criteriaInstruction,
    "Use web search to ground every option and every value in something you actually found — never invent or estimate a plausible-looking number, and never include an option or a value you cannot cite a real source for.",
    'Every value must include a "source" (a URL or publication name a person could actually check).',
    'If you cannot find anything groundable for this subject, return { "options": [] } — an honest empty result, not a fabricated one.',
  ].join("\n");
}

/**
 * Uses Claude's web-search tool (a server-executed tool, not a bare chat
 * completion) so results are grounded in something Claude actually
 * fetched, not just training data, combined with structured JSON output
 * (`output_config.format`) so the final text block is already
 * schema-constrained — no markdown-fence stripping or prose-around-JSON
 * parsing needed. Both features are checked against the installed
 * `@anthropic-ai/sdk` version (`web_search_20260318`, `output_config`) at
 * implementation time per this sprint's own instruction that this exact
 * shape may have moved since the brief was written.
 */
export const anthropicAIProvider: AIProvider = {
  id: ANTHROPIC_AI_PROVIDER_ID,
  name: "Anthropic (Claude)",
  capabilities: ["information:retrieve"],
  authType: "api_key",
  async researchMarketOptions(subject: string, criteria: string[]): Promise<MarketOption[]> {
    const client = getClient();

    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 4096,
        tools: [{ type: "web_search_20260318", name: "web_search", max_uses: 5 }],
        output_config: { format: { type: "json_schema", schema: MARKET_OPTIONS_SCHEMA } },
        messages: [{ role: "user", content: buildPrompt(subject, criteria) }],
      });
    } catch (error) {
      if (error instanceof Anthropic.APIError && error.status === 401) {
        throw new ProviderError("unauthorized", "Anthropic API key was rejected.");
      }
      throw new ProviderError("unavailable", "Could not reach the Anthropic API.");
    }

    // The model may emit multiple text blocks around tool-use turns; the
    // schema-constrained final answer is the last one.
    let finalText: string | undefined;
    for (const block of response.content) {
      if (block.type === "text") finalText = block.text;
    }
    if (finalText === undefined) {
      throw new ProviderError("unavailable", "Anthropic response contained no text output.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(finalText);
    } catch {
      throw new ProviderError("unavailable", "Anthropic response was not valid JSON.");
    }

    return mapMarketOptionsResponse(parsed);
  },
};
