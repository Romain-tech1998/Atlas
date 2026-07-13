import { describe, it, expect } from "vitest";
import { compareOptionsSkill, type ComparableOptionValue } from "@/skills/compare-options";

function run(values: ComparableOptionValue[]) {
  return compareOptionsSkill.run({ values });
}

function find(ranking: { optionLabel: string; score: number; comparedEvidenceIds: string[] }[], optionLabel: string) {
  const entry = ranking.find((r) => r.optionLabel === optionLabel);
  if (!entry) throw new Error(`no ranking entry for ${optionLabel}`);
  return entry;
}

describe("compareOptionsSkill", () => {
  it("two options, one shared measure (price, lower_is_better): cheaper option wins outright", () => {
    const result = run([
      { evidenceId: "e1", optionLabel: "A", kind: "numeric", value: 100, measure: "price", observedAt: "2026-01-01" },
      { evidenceId: "e2", optionLabel: "B", kind: "numeric", value: 200, measure: "price", observedAt: "2026-01-01" },
    ]);
    if ("insufficientEvidence" in result) throw new Error("expected a ranking");
    expect(find(result.ranking, "A")).toMatchObject({ score: 1, comparedEvidenceIds: ["e1"] });
    expect(find(result.ranking, "B")).toMatchObject({ score: 0, comparedEvidenceIds: ["e2"] });
    expect(result.ranking[0].optionLabel).toBe("A");
  });

  it("two options, two shared measures (price + rating, opposite directions): asserts the actual summed scores", () => {
    const result = run([
      { evidenceId: "e1", optionLabel: "A", kind: "numeric", value: 100, measure: "price", observedAt: "2026-01-01" },
      { evidenceId: "e2", optionLabel: "B", kind: "numeric", value: 200, measure: "price", observedAt: "2026-01-01" },
      { evidenceId: "e3", optionLabel: "A", kind: "numeric", value: 5, measure: "rating", observedAt: "2026-01-01" },
      { evidenceId: "e4", optionLabel: "B", kind: "numeric", value: 3, measure: "rating", observedAt: "2026-01-01" },
    ]);
    if ("insufficientEvidence" in result) throw new Error("expected a ranking");
    // price: A=100 (best, sub=1), B=200 (worst, sub=0)
    // rating: A=5 (best, sub=1), B=3 (worst, sub=0)
    expect(find(result.ranking, "A")).toMatchObject({ score: 2, comparedEvidenceIds: ["e1", "e3"] });
    expect(find(result.ranking, "B")).toMatchObject({ score: 0, comparedEvidenceIds: ["e2", "e4"] });
    expect(result.ranking[0].optionLabel).toBe("A");
  });

  it("three options where only two share a compatible measure: the third's absence from that group doesn't error", () => {
    const result = run([
      { evidenceId: "e1", optionLabel: "A", kind: "numeric", value: 100, measure: "price", observedAt: "2026-01-01" },
      { evidenceId: "e2", optionLabel: "B", kind: "numeric", value: 200, measure: "price", observedAt: "2026-01-01" },
      { evidenceId: "e3", optionLabel: "B", kind: "numeric", value: 4, measure: "rating", observedAt: "2026-01-01" },
      { evidenceId: "e4", optionLabel: "C", kind: "numeric", value: 5, measure: "rating", observedAt: "2026-01-01" },
    ]);
    if ("insufficientEvidence" in result) throw new Error("expected a ranking");
    expect(result.ranking).toHaveLength(3);
    // A only ever appears in the price group: sub=1 (best), nothing from rating.
    expect(find(result.ranking, "A")).toMatchObject({ score: 1, comparedEvidenceIds: ["e1"] });
    // B is in both groups: price sub=0 (worst) + rating sub=0 (worst) = 0.
    expect(find(result.ranking, "B")).toMatchObject({ score: 0, comparedEvidenceIds: ["e2", "e3"] });
    // C only ever appears in the rating group: sub=1 (best), nothing from price.
    expect(find(result.ranking, "C")).toMatchObject({ score: 1, comparedEvidenceIds: ["e4"] });
  });

  it("an option with two Evidence items for the same measure: the most-recently-observed one wins, not an average", () => {
    const result = run([
      { evidenceId: "e1", optionLabel: "A", kind: "numeric", value: 200, measure: "price", observedAt: "2026-01-01" },
      { evidenceId: "e2", optionLabel: "A", kind: "numeric", value: 100, measure: "price", observedAt: "2026-02-01" },
      { evidenceId: "e3", optionLabel: "B", kind: "numeric", value: 120, measure: "price", observedAt: "2026-01-15" },
    ]);
    if ("insufficientEvidence" in result) throw new Error("expected a ranking");
    // If e1 (200) and e2 (100) had been averaged, A's value would be 150, not 100.
    // A's latest (e2, 100) beats B's 120 outright: min=100, max=120.
    expect(find(result.ranking, "A")).toMatchObject({ score: 1, comparedEvidenceIds: ["e2"] });
    expect(find(result.ranking, "B")).toMatchObject({ score: 0, comparedEvidenceIds: ["e3"] });
  });

  it("all values tied on a measure (max === min): every option gets a full sub-score of 1", () => {
    const result = run([
      { evidenceId: "e1", optionLabel: "A", kind: "numeric", value: 100, measure: "price", observedAt: "2026-01-01" },
      { evidenceId: "e2", optionLabel: "B", kind: "numeric", value: 100, measure: "price", observedAt: "2026-01-01" },
    ]);
    if ("insufficientEvidence" in result) throw new Error("expected a ranking");
    expect(find(result.ranking, "A")).toMatchObject({ score: 1 });
    expect(find(result.ranking, "B")).toMatchObject({ score: 1 });
  });

  it("currency mismatch (USD vs CAD for price): they don't group together, same as find_lowest_value's rule", () => {
    const result = run([
      { evidenceId: "e1", optionLabel: "A", kind: "currency", value: 100, currency: "USD", measure: "price", observedAt: "2026-01-01" },
      { evidenceId: "e2", optionLabel: "B", kind: "currency", value: 100, currency: "CAD", measure: "price", observedAt: "2026-01-01" },
    ]);
    expect(result).toEqual({ insufficientEvidence: true });
  });

  it("fewer than two distinct optionLabels with any comparable measure at all: insufficientEvidence", () => {
    const result = run([
      { evidenceId: "e1", optionLabel: "A", kind: "numeric", value: 100, measure: "price", observedAt: "2026-01-01" },
      { evidenceId: "e2", optionLabel: "A", kind: "numeric", value: 150, measure: "price", observedAt: "2026-02-01" },
    ]);
    expect(result).toEqual({ insufficientEvidence: true });
  });

  it("tie in final total score: stable order preserved (first-seen order)", () => {
    // Input order: B-price, A-price, A-rating, B-rating — "numeric:price" is the
    // first compatibility key seen, so B (first in that group) is first-seen overall.
    const result = run([
      { evidenceId: "e1", optionLabel: "B", kind: "numeric", value: 200, measure: "price", observedAt: "2026-01-01" },
      { evidenceId: "e2", optionLabel: "A", kind: "numeric", value: 100, measure: "price", observedAt: "2026-01-01" },
      { evidenceId: "e3", optionLabel: "A", kind: "numeric", value: 3, measure: "rating", observedAt: "2026-01-01" },
      { evidenceId: "e4", optionLabel: "B", kind: "numeric", value: 5, measure: "rating", observedAt: "2026-01-01" },
    ]);
    if ("insufficientEvidence" in result) throw new Error("expected a ranking");
    // price: A=100 (best, sub=1), B=200 (worst, sub=0)
    // rating: B=5 (best, sub=1), A=3 (worst, sub=0)
    // Both total 1 — a genuine tie.
    expect(find(result.ranking, "A")).toMatchObject({ score: 1 });
    expect(find(result.ranking, "B")).toMatchObject({ score: 1 });
    expect(result.ranking.map((r) => r.optionLabel)).toEqual(["B", "A"]);
  });
});
