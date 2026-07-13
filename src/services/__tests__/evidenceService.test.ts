import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { missionService } from "@/services/missionService";
import { evidenceService } from "@/services/evidenceService";
import { verdictRepository } from "@/services/verdictRepository";
import { createTestUser, deleteTestUser } from "@/test/helpers";

describe("evidenceService — compare_options Verdict branching (Sprint-030)", () => {
  let userId: string;
  let decisionId: string;

  beforeEach(async () => {
    const user = await createTestUser();
    userId = user.id;
    const { missionId } = await missionService.createMission(userId, "Compare the Nike Crew Neck and the Uniqlo U Crew");
    const summary = await missionService.getMissionSummary(userId, missionId);
    decisionId = summary!.activeDecision!.id;
  });

  afterEach(async () => {
    await deleteTestUser(userId);
  });

  it("two options, each with one price-measured labeled Evidence item: PRODUCED via compare_options with a length-2 ranking", async () => {
    await evidenceService.addEvidence(userId, decisionId, {
      claim: "Nike Crew Neck price",
      source: "user",
      value: 45,
      currency: "CAD",
      measure: "price",
      optionLabel: "Nike Crew Neck",
    });
    await evidenceService.addEvidence(userId, decisionId, {
      claim: "Uniqlo U Crew price",
      source: "user",
      value: 30,
      currency: "CAD",
      measure: "price",
      optionLabel: "Uniqlo U Crew",
    });

    const verdict = await verdictRepository.getVerdictForDecision(userId, decisionId);
    expect(verdict?.status).toBe("PRODUCED");
    expect(verdict?.ranking).toHaveLength(2);
    expect(verdict?.ranking?.map((r) => r.optionLabel).sort()).toEqual(["Nike Crew Neck", "Uniqlo U Crew"].sort());
    expect(verdict?.comparedEvidenceIds).toHaveLength(2);
  });

  it("only one distinct optionLabel present: falls back to find_lowest_value, unaffected by this sprint (2 unlabeled comparable items)", async () => {
    await evidenceService.addEvidence(userId, decisionId, { claim: "Store A price", source: "user", value: 100, currency: "CAD", measure: "price" });
    await evidenceService.addEvidence(userId, decisionId, { claim: "Store B price", source: "user", value: 80, currency: "CAD", measure: "price" });

    const verdict = await verdictRepository.getVerdictForDecision(userId, decisionId);
    expect(verdict?.status).toBe("PRODUCED");
    expect(verdict?.ranking).toBeNull();
    expect(verdict?.comparedEvidenceIds).toHaveLength(2);
  });

  it("mixed: labeled items sharing one optionLabel plus an unlabeled item — still falls back to find_lowest_value, unaffected by the unlabeled item", async () => {
    await evidenceService.addEvidence(userId, decisionId, {
      claim: "Nike Crew Neck price (listing 1)",
      source: "user",
      value: 100,
      currency: "CAD",
      measure: "price",
      optionLabel: "Nike Crew Neck",
    });
    await evidenceService.addEvidence(userId, decisionId, {
      claim: "Nike Crew Neck price (listing 2)",
      source: "user",
      value: 90,
      currency: "CAD",
      measure: "price",
      optionLabel: "Nike Crew Neck",
    });
    const thirdEvidence = await evidenceService.addEvidence(userId, decisionId, {
      claim: "Unlabeled price mention",
      source: "user",
      value: 80,
      currency: "CAD",
      measure: "price",
    });

    const verdict = await verdictRepository.getVerdictForDecision(userId, decisionId);
    expect(verdict?.status).toBe("PRODUCED");
    // Only one distinct optionLabel ("Nike Crew Neck") exists, so compare_options
    // never triggers — this is find_lowest_value's fallback, and it isn't
    // filtered by optionLabel at all, so all 3 comparable items participate.
    expect(verdict?.ranking).toBeNull();
    expect(verdict?.comparedEvidenceIds).toHaveLength(3);
    expect(verdict?.comparedEvidenceIds).toContain(thirdEvidence.id);
  });

  it("adding a third labeled option updates a previously-PRODUCED compare_options Verdict's ranking to length 3", async () => {
    await evidenceService.addEvidence(userId, decisionId, {
      claim: "Nike Crew Neck price",
      source: "user",
      value: 45,
      currency: "CAD",
      measure: "price",
      optionLabel: "Nike Crew Neck",
    });
    await evidenceService.addEvidence(userId, decisionId, {
      claim: "Uniqlo U Crew price",
      source: "user",
      value: 30,
      currency: "CAD",
      measure: "price",
      optionLabel: "Uniqlo U Crew",
    });

    const before = await verdictRepository.getVerdictForDecision(userId, decisionId);
    expect(before?.ranking).toHaveLength(2);

    await evidenceService.addEvidence(userId, decisionId, {
      claim: "Everlane Crew price",
      source: "user",
      value: 38,
      currency: "CAD",
      measure: "price",
      optionLabel: "Everlane Crew",
    });

    const after = await verdictRepository.getVerdictForDecision(userId, decisionId);
    expect(after?.status).toBe("PRODUCED");
    expect(after?.ranking).toHaveLength(3);
    expect(after?.ranking?.map((r) => r.optionLabel).sort()).toEqual(
      ["Nike Crew Neck", "Uniqlo U Crew", "Everlane Crew"].sort(),
    );
  });
});
