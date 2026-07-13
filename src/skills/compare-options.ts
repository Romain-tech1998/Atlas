import type { Skill } from "@/skills/skillEngine";
import { MEASURE_DIRECTION, type NormalizedMeasure } from "@/domain/evidence-normalization";

/** RFC-0003 §9 `compare_options`. `measure` is required (unlike
 * `find_lowest_value`'s `ComparableValue.measure?`) — an unmeasured value
 * can't contribute to any criterion, so callers filter it out before this
 * Skill ever sees it, same hard rule `find_lowest_value` applies, just
 * enforced one level earlier here since there's no meaningful "unknown
 * criterion" case to even consider. */
export interface ComparableOptionValue {
  evidenceId: string;
  optionLabel: string;
  kind: "numeric" | "currency";
  value: number;
  currency?: string;
  measure: NormalizedMeasure;
  observedAt: string;
}

export interface CompareOptionsInput {
  values: ComparableOptionValue[];
}

export interface RankedOption {
  optionLabel: string;
  score: number;
  comparedEvidenceIds: string[];
}

export interface CompareOptionsSuccess {
  ranking: RankedOption[];
}

export interface CompareOptionsInsufficient {
  insufficientEvidence: true;
}

export type CompareOptionsOutput = CompareOptionsSuccess | CompareOptionsInsufficient;

/** Same compatibility key as `find_lowest_value`: same `kind`, same
 * `currency` for currency values, same `measure`. */
function compatibilityKey(value: ComparableOptionValue): string {
  return value.kind === "currency" ? `currency:${value.currency}:${value.measure}` : `numeric:${value.measure}`;
}

/** One value per (optionLabel, measure-group) — if an option has more than
 * one Evidence item for the same compatible group, the most recently
 * observed one represents it (ties broken by input order), same "latest
 * wins" convention already used elsewhere (e.g. Sprint-020's Learning
 * Signal source). Never averaged — averaging would silently invent a
 * number neither Evidence item actually claimed. */
function latestPerOption(values: ComparableOptionValue[]): Map<string, ComparableOptionValue> {
  const byOption = new Map<string, ComparableOptionValue>();
  for (const value of values) {
    const existing = byOption.get(value.optionLabel);
    if (!existing || new Date(value.observedAt) >= new Date(existing.observedAt)) {
      byOption.set(value.optionLabel, value);
    }
  }
  return byOption;
}

/** Min-max normalize one compatibility group to a 0–1 sub-score per
 * option, direction-aware. When every value in the group is identical
 * (max === min), every option gets a full sub-score of 1 — "tied" means
 * no option is worse than another on this measure, not an arbitrary
 * midpoint. */
function scoreGroup(byOption: Map<string, ComparableOptionValue>, direction: "lower_is_better" | "higher_is_better") {
  const entries = [...byOption.entries()];
  const values = entries.map(([, v]) => v.value);
  const min = Math.min(...values);
  const max = Math.max(...values);

  return entries.map(([optionLabel, value]) => {
    if (max === min) return { optionLabel, evidenceId: value.evidenceId, subScore: 1 };
    const normalized = (value.value - min) / (max - min);
    const subScore = direction === "lower_is_better" ? 1 - normalized : normalized;
    return { optionLabel, evidenceId: value.evidenceId, subScore };
  });
}

/**
 * Sprint-029 (RFC-0003 §7a/§9): the multi-criteria sibling of
 * `find_lowest_value`. Deterministic per-measure min-max normalization,
 * summed per option — never an LLM judgment call, never a weighted guess
 * at "importance" between measures (every measure contributes equally;
 * weighting is a concrete future case, not something to invent now).
 */
function run(input: CompareOptionsInput): CompareOptionsOutput {
  const groups = new Map<string, ComparableOptionValue[]>();
  for (const value of input.values) {
    const key = compatibilityKey(value);
    const group = groups.get(key);
    if (group) group.push(value);
    else groups.set(key, [value]);
  }

  const totals = new Map<string, { score: number; evidenceIds: string[] }>();
  const firstSeenOrder: string[] = [];

  for (const [, groupValues] of groups) {
    const byOption = latestPerOption(groupValues);
    if (byOption.size < 2) continue; // need 2+ distinct options to compare on this measure

    const measure = groupValues[0].measure;
    const direction = MEASURE_DIRECTION[measure];
    const scored = scoreGroup(byOption, direction);

    for (const { optionLabel, evidenceId, subScore } of scored) {
      if (!totals.has(optionLabel)) {
        totals.set(optionLabel, { score: 0, evidenceIds: [] });
        firstSeenOrder.push(optionLabel);
      }
      const entry = totals.get(optionLabel)!;
      entry.score += subScore;
      entry.evidenceIds.push(evidenceId);
    }
  }

  if (totals.size < 2) return { insufficientEvidence: true };

  const ranking = firstSeenOrder
    .map((optionLabel) => ({
      optionLabel,
      score: totals.get(optionLabel)!.score,
      comparedEvidenceIds: totals.get(optionLabel)!.evidenceIds,
    }))
    .sort((a, b) => b.score - a.score); // stable sort: ties keep firstSeenOrder

  return { ranking };
}

export const compareOptionsSkill: Skill<CompareOptionsInput, CompareOptionsOutput> = {
  id: "compare_options",
  sideEffects: "none",
  run,
};
