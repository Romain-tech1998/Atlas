import type { Skill } from "@/skills/skillEngine";

/**
 * RFC-0003 §9 `find_lowest_value` input shape: already-normalized values
 * (via `normalizeEvidence`, `src/domain/evidence-normalization.ts`) — this
 * Skill never sees a raw Evidence claim. Deliberately narrower than
 * `NormalizedValue`: only the two comparable kinds are representable here,
 * so an incompatible kind (`date`, `user_provided`) can't even be passed in
 * by mistake.
 */
export interface ComparableValue {
  evidenceId: string;
  kind: "numeric" | "currency";
  value: number;
  /** Present only for `kind: "currency"`. */
  currency?: string;
  /** RFC-0001 §4 "Measure" (Sprint-007) — what the value represents (e.g.
   * `"price"`, `"budget"`). Absent means unknown. Plain `string` here
   * (not `NormalizedMeasure`) deliberately — this Skill's input contract
   * shouldn't depend on the domain layer's specific vocabulary type, only
   * on whether two values' measures match. */
  measure?: string;
}

export interface FindLowestValueInput {
  values: ComparableValue[];
}

export interface FindLowestValueSuccess {
  evidenceId: string;
  value: number;
  /** Every Evidence id in the one compatible group that was actually
   * compared — including the winner (RFC-0001 §4 traceability). */
  comparedEvidenceIds: string[];
}

export interface FindLowestValueInsufficient {
  insufficientEvidence: true;
}

export type FindLowestValueOutput = FindLowestValueSuccess | FindLowestValueInsufficient;

/** Two values are only ever compared if they share this key: same `kind`,
 * same `currency` for `currency` values, **and** the same `measure`
 * (RFC-0001 §4 "Measure", Sprint-007). No unit conversion, no
 * cross-currency comparison, no cross-measure comparison (a price and a
 * budget in the same currency are never compared) — RFC-0003 §9's
 * compatibility rule. Callers with no recognized `measure` never reach this
 * function at all (see the hard-rule filter in `run` below). */
function compatibilityKey(value: ComparableValue): string {
  return value.kind === "currency" ? `currency:${value.currency}:${value.measure}` : `numeric:${value.measure}`;
}

/**
 * Atlas's first real reasoning capability (Sprint-006, RFC-0003 §8a/§9;
 * measure-aware since Sprint-007). Groups the input by compatibility, then
 * compares only within a group — never across kinds, currencies, or
 * measures, never guessing a conversion or a shared meaning. If the input
 * splits into more than one group of 2+ (e.g. some CAD prices and some USD
 * prices given together), which one is "the" comparison the caller meant is
 * genuinely ambiguous — this Skill doesn't guess which, it reports
 * insufficient evidence rather than silently picking a group. Same is true
 * with zero or one usable group: fewer than two compatible values is never
 * enough to compare.
 *
 * Hard rule (RFC-0001 §4): a value with no recognized `measure` can never
 * join a comparable group — not even with another unknown-measure value.
 * "Unknown" isn't itself a measure two values can share, so such values are
 * filtered out before grouping even starts, rather than grouped under some
 * `"unknown"` bucket that could then satisfy the "2+ values" threshold.
 *
 * Deterministic and reproducible: same input array, same output, always —
 * ties are broken by first occurrence (stable `reduce`), never at random.
 */
function run(input: FindLowestValueInput): FindLowestValueOutput {
  const groups = new Map<string, ComparableValue[]>();
  for (const value of input.values) {
    if (!value.measure) continue;
    const key = compatibilityKey(value);
    const group = groups.get(key);
    if (group) group.push(value);
    else groups.set(key, [value]);
  }

  const comparableGroups = [...groups.values()].filter((group) => group.length >= 2);
  if (comparableGroups.length !== 1) return { insufficientEvidence: true };

  const [group] = comparableGroups;
  const lowest = group.reduce((min, current) => (current.value < min.value ? current : min));

  return { evidenceId: lowest.evidenceId, value: lowest.value, comparedEvidenceIds: group.map((v) => v.evidenceId) };
}

export const findLowestValueSkill: Skill<FindLowestValueInput, FindLowestValueOutput> = {
  id: "find_lowest_value",
  sideEffects: "none",
  run,
};
