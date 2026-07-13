import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { missionService } from "@/services/missionService";
import { decisionService } from "@/services/decisionService";
import { decisionRepository } from "@/services/decisionRepository";
import { verdictRepository } from "@/services/verdictRepository";
import { createTestUser, deleteTestUser, produceVerdict } from "@/test/helpers";

describe("decisionService — Verdict lifecycle (Sprint-006/017)", () => {
  let userId: string;
  let missionId: string;
  let decisionId: string;

  beforeEach(async () => {
    const user = await createTestUser();
    userId = user.id;
    const { missionId: newMissionId } = await missionService.createMission(userId, "I need to buy groceries tomorrow");
    missionId = newMissionId;
    const summary = await missionService.getMissionSummary(userId, missionId);
    decisionId = summary!.activeDecision!.id;
    await produceVerdict(userId, decisionId);
  });

  afterEach(async () => {
    await deleteTestUser(userId);
  });

  it("accepting a produced Verdict resolves the Decision as ACCEPTED", async () => {
    await decisionService.resolveDecision(userId, decisionId, { outcome: "accepted" });

    const decision = await decisionRepository.getDecisionById(userId, decisionId);
    expect(decision?.status).toBe("RESOLVED");
    expect(decision?.resolutionOutcome).toBe("ACCEPTED");
    expect(decision?.resolutionNote).toBeNull();
  });

  it("declining a produced Verdict resolves the Decision as DECLINED with the supplied note", async () => {
    await decisionService.resolveDecision(userId, decisionId, {
      outcome: "declined",
      note: "chose a different store instead",
    });

    const decision = await decisionRepository.getDecisionById(userId, decisionId);
    expect(decision?.status).toBe("RESOLVED");
    expect(decision?.resolutionOutcome).toBe("DECLINED");
    expect(decision?.resolutionNote).toBe("chose a different store instead");
  });

  it("the Verdict's own recommendation/reasoning never change through resolution", async () => {
    const before = await verdictRepository.getVerdictForDecision(userId, decisionId);
    expect(before?.status).toBe("PRODUCED");

    await decisionService.resolveDecision(userId, decisionId, { outcome: "accepted" });

    const after = await verdictRepository.getVerdictForDecision(userId, decisionId);
    expect(after?.recommendation).toEqual(before?.recommendation);
    expect(after?.reasoning).toEqual(before?.reasoning);
    expect(after?.comparedEvidenceIds).toEqual(before?.comparedEvidenceIds);
  });

  it("a second resolution attempt on an already-resolved Decision fails with DecisionAlreadyResolvedError", async () => {
    await decisionService.resolveDecision(userId, decisionId, { outcome: "accepted" });

    await expect(decisionService.resolveDecision(userId, decisionId, { outcome: "accepted" })).rejects.toThrow(
      decisionService.DecisionAlreadyResolvedError,
    );
  });
});
