import { describe, it, expect } from "vitest";
import type { EvidenceItem } from "@/domain/decision";
import { NORMALIZED_MEASURES, MEASURE_DIRECTION, normalizeEvidence } from "@/domain/evidence-normalization";

function makeEvidence(overrides: Partial<EvidenceItem>): EvidenceItem {
  return {
    id: "evidence-1",
    claim: "",
    source: "user",
    observedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    metadata: null,
    ...overrides,
  };
}

describe("MEASURE_DIRECTION", () => {
  it("has an entry for every member of NORMALIZED_MEASURES", () => {
    for (const measure of NORMALIZED_MEASURES) {
      expect(MEASURE_DIRECTION[measure]).toBeDefined();
      expect(["lower_is_better", "higher_is_better"]).toContain(MEASURE_DIRECTION[measure]);
    }
  });
});

describe("normalizeEvidence — Sprint-029 measures (rating, quality, brand_score)", () => {
  it("recognizes 'rating' via metadata.measure", () => {
    const evidence = makeEvidence({
      claim: "This one has a great reputation.",
      metadata: { value: 4.5, measure: "rating" },
    });
    const [value] = normalizeEvidence(evidence);
    expect(value).toMatchObject({ kind: "numeric", value: 4.5, measure: "rating" });
  });

  it("recognizes 'rating' via the 'rated' claim keyword alongside a currency claim", () => {
    const evidence = makeEvidence({ claim: "It's rated well. USD 20 total." });
    const [value] = normalizeEvidence(evidence);
    expect(value).toMatchObject({ kind: "currency", value: 20, currency: "USD", measure: "rating" });
  });

  it("recognizes 'rating' via the 'rating is' claim keyword alongside a currency claim", () => {
    const evidence = makeEvidence({ claim: "The rating is high. USD 20 total." });
    const [value] = normalizeEvidence(evidence);
    expect(value).toMatchObject({ kind: "currency", value: 20, currency: "USD", measure: "rating" });
  });

  it("recognizes 'quality' via metadata.measure", () => {
    const evidence = makeEvidence({
      claim: "Quality assessment.",
      metadata: { value: 8, measure: "quality" },
    });
    const [value] = normalizeEvidence(evidence);
    expect(value).toMatchObject({ kind: "numeric", value: 8, measure: "quality" });
  });

  it("recognizes 'quality' via the 'quality is' claim keyword", () => {
    const evidence = makeEvidence({ claim: "The quality is excellent. CAD 50 total." });
    const [value] = normalizeEvidence(evidence);
    expect(value).toMatchObject({ kind: "currency", value: 50, currency: "CAD", measure: "quality" });
  });

  it("recognizes 'brand_score' via metadata.measure", () => {
    const evidence = makeEvidence({
      claim: "Brand assessment.",
      metadata: { value: 72, measure: "brand_score" },
    });
    const [value] = normalizeEvidence(evidence);
    expect(value).toMatchObject({ kind: "numeric", value: 72, measure: "brand_score" });
  });

  it("recognizes 'brand_score' via the 'brand score is' claim keyword", () => {
    const evidence = makeEvidence({ claim: "The brand score is strong. EUR 30 total." });
    const [value] = normalizeEvidence(evidence);
    expect(value).toMatchObject({ kind: "currency", value: 30, currency: "EUR", measure: "brand_score" });
  });

  it("recognizes 'duration' via metadata.measure", () => {
    const evidence = makeEvidence({
      claim: "Flight length.",
      metadata: { value: 7, measure: "duration" },
    });
    const [value] = normalizeEvidence(evidence);
    expect(value).toMatchObject({ kind: "numeric", value: 7, measure: "duration" });
  });

  it("recognizes 'duration' via the 'duration is' claim keyword alongside a currency claim", () => {
    const evidence = makeEvidence({ claim: "The duration is long. USD 20 total." });
    const [value] = normalizeEvidence(evidence);
    expect(value).toMatchObject({ kind: "currency", value: 20, currency: "USD", measure: "duration" });
  });

  it("recognizes 'duration' via the 'takes' claim keyword alongside a currency claim", () => {
    const evidence = makeEvidence({ claim: "The flight takes 7 hours. USD 20 total." });
    const [value] = normalizeEvidence(evidence);
    expect(value).toMatchObject({ kind: "currency", value: 20, currency: "USD", measure: "duration" });
  });

  it("treats an unrecognized metadata.measure value the same as absent (unknown)", () => {
    const evidence = makeEvidence({
      claim: "Some claim.",
      metadata: { value: 5, measure: "not_a_real_measure" },
    });
    const [value] = normalizeEvidence(evidence);
    expect(value).toMatchObject({ kind: "numeric", value: 5 });
    expect((value as { measure?: string }).measure).toBeUndefined();
  });
});
