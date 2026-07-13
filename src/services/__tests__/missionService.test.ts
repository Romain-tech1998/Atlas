import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { missionService } from "@/services/missionService";
import { decisionService } from "@/services/decisionService";
import { decisionRepository } from "@/services/decisionRepository";
import { createTestUser, deleteTestUser, produceVerdict } from "@/test/helpers";

/** Deterministic raw-input strings, chosen by reading the actual
 * intent/entity rules (`src/brain/intent/intentEngine.ts`,
 * `src/brain/entity/entityEngine.ts`) rather than guessed: `"i need to "`
 * triggers `create_task`, and `"tomorrow"` is a recognized due-date keyword
 * — so this input always routes to the `task` module with `missingInfo: []`
 * (never blocked), giving every test a reproducible, non-blocked founding
 * Decision without depending on which specific module handled it. */
const TASK_INPUT = "I need to buy groceries tomorrow";
const TASK_INPUT_2 = "I need to buy a new laptop tomorrow";
const TASK_INPUT_3 = "I need to book a dentist appointment tomorrow";

async function signalsForMission(userId: string, missionId: string) {
  return prisma.learningSignal.findMany({
    where: { userId, payload: { path: ["missionId"], equals: missionId } },
  });
}

describe("missionService — Decision lifecycle via Mission updates (Sprint-018)", () => {
  let userId: string;

  beforeEach(async () => {
    userId = (await createTestUser()).id;
  });

  afterEach(async () => {
    await deleteTestUser(userId);
  });

  it("the first update creates the Mission's first Decision", async () => {
    const { missionId } = await missionService.createMission(userId, TASK_INPUT);

    const summary = await missionService.getMissionSummary(userId, missionId);
    expect(summary?.decisions).toHaveLength(1);
    expect(summary?.decisions[0].number).toBe(1);
    expect(summary?.activeDecision?.id).toBe(summary?.decisions[0].id);
  });

  it("branch A — further updates continue on the currently active Decision", async () => {
    const { missionId } = await missionService.createMission(userId, TASK_INPUT);
    await missionService.addMissionUpdate(userId, missionId, "Actually make it a big shop tomorrow");

    const summary = await missionService.getMissionSummary(userId, missionId);
    expect(summary?.decisions).toHaveLength(1);
    expect(summary?.decisions[0].updateCount).toBe(2);
  });

  it("branch B — an update after RESOLVED starts the Mission's next Decision", async () => {
    const { missionId } = await missionService.createMission(userId, TASK_INPUT);
    const decisionId = (await missionService.getMissionSummary(userId, missionId))!.activeDecision!.id;

    await produceVerdict(userId, decisionId);
    await decisionService.resolveDecision(userId, decisionId, { outcome: "accepted" });
    await missionService.addMissionUpdate(userId, missionId, TASK_INPUT_2);

    const summary = await missionService.getMissionSummary(userId, missionId);
    expect(summary?.decisions).toHaveLength(2);
    expect(summary?.decisions[1].number).toBe(2);
    expect(summary?.activeDecision?.id).toBe(summary?.decisions[1].id);
    expect(summary?.decisions[0].status).toBe("RESOLVED");
  });

  it("at most one active Decision ever exists", async () => {
    const { missionId } = await missionService.createMission(userId, TASK_INPUT);
    const decisionId = (await missionService.getMissionSummary(userId, missionId))!.activeDecision!.id;
    await produceVerdict(userId, decisionId);
    await decisionService.resolveDecision(userId, decisionId, { outcome: "accepted" });
    await missionService.addMissionUpdate(userId, missionId, TASK_INPUT_2);

    const summary = await missionService.getMissionSummary(userId, missionId);
    const activeCount = summary!.decisions.filter((decision) => decision.isActive).length;
    expect(activeCount).toBe(1);
  });

  it("resolved Decisions are immutable — a later Decision's activity never changes an already-resolved one", async () => {
    const { missionId } = await missionService.createMission(userId, TASK_INPUT);
    const firstDecisionId = (await missionService.getMissionSummary(userId, missionId))!.activeDecision!.id;
    await produceVerdict(userId, firstDecisionId);
    await decisionService.resolveDecision(userId, firstDecisionId, {
      outcome: "declined",
      note: "went with something else",
    });

    const beforeSecondUpdate = await decisionRepository.getDecisionById(userId, firstDecisionId);
    await missionService.addMissionUpdate(userId, missionId, TASK_INPUT_2);
    const afterSecondUpdate = await decisionRepository.getDecisionById(userId, firstDecisionId);

    expect(afterSecondUpdate?.status).toBe("RESOLVED");
    expect(afterSecondUpdate?.resolutionOutcome).toBe(beforeSecondUpdate?.resolutionOutcome);
    expect(afterSecondUpdate?.resolutionNote).toBe(beforeSecondUpdate?.resolutionNote);
    expect(afterSecondUpdate?.updatedAt).toEqual(beforeSecondUpdate?.updatedAt);
  });
});

describe("missionService — Mission lifecycle (Sprint-020)", () => {
  let userId: string;

  beforeEach(async () => {
    userId = (await createTestUser()).id;
  });

  afterEach(async () => {
    await deleteTestUser(userId);
  });

  it("completing a Mission archives its open Decision, never resolves it", async () => {
    const { missionId } = await missionService.createMission(userId, TASK_INPUT);
    const decisionId = (await missionService.getMissionSummary(userId, missionId))!.activeDecision!.id;

    await missionService.setMissionStatus(userId, missionId, "COMPLETED");

    const decision = await decisionRepository.getDecisionById(userId, decisionId);
    expect(decision?.status).toBe("ARCHIVED");
    expect(decision?.resolutionOutcome).toBeNull();
  });

  it("abandoning a Mission archives its open Decision the same way", async () => {
    const { missionId } = await missionService.createMission(userId, TASK_INPUT);
    const decisionId = (await missionService.getMissionSummary(userId, missionId))!.activeDecision!.id;

    await missionService.setMissionStatus(userId, missionId, "ABANDONED");

    const decision = await decisionRepository.getDecisionById(userId, decisionId);
    expect(decision?.status).toBe("ARCHIVED");
    expect(decision?.resolutionOutcome).toBeNull();
  });

  it("a terminal Mission rejects addMissionUpdate with MissionNotActiveError", async () => {
    const { missionId } = await missionService.createMission(userId, TASK_INPUT);
    await missionService.setMissionStatus(userId, missionId, "ABANDONED");

    await expect(missionService.addMissionUpdate(userId, missionId, TASK_INPUT_2)).rejects.toThrow(
      missionService.MissionNotActiveError,
    );
  });

  it("completion never touches a Decision that's already RESOLVED", async () => {
    const { missionId } = await missionService.createMission(userId, TASK_INPUT);
    const decisionId = (await missionService.getMissionSummary(userId, missionId))!.activeDecision!.id;
    await produceVerdict(userId, decisionId);
    await decisionService.resolveDecision(userId, decisionId, { outcome: "accepted" });

    await missionService.setMissionStatus(userId, missionId, "COMPLETED");

    const decision = await decisionRepository.getDecisionById(userId, decisionId);
    expect(decision?.status).toBe("RESOLVED");
    expect(decision?.resolutionOutcome).toBe("ACCEPTED");
  });
});

describe("missionService — Learning Signals (Sprint-020/022)", () => {
  let userId: string;

  beforeEach(async () => {
    userId = (await createTestUser()).id;
  });

  afterEach(async () => {
    await deleteTestUser(userId);
  });

  it("exactly one signal is recorded per terminal transition", async () => {
    const { missionId } = await missionService.createMission(userId, TASK_INPUT);

    await missionService.setMissionStatus(userId, missionId, "COMPLETED");

    const signals = await signalsForMission(userId, missionId);
    expect(signals).toHaveLength(1);
    expect(signals[0].signalType).toBe("USER_FEEDBACK_POSITIVE");
  });

  it("a losing/duplicate transition attempt writes no additional signal", async () => {
    const { missionId } = await missionService.createMission(userId, TASK_INPUT);
    await missionService.setMissionStatus(userId, missionId, "COMPLETED");

    await expect(missionService.setMissionStatus(userId, missionId, "COMPLETED")).rejects.toThrow(
      missionService.MissionAlreadyTerminalError,
    );

    const signals = await signalsForMission(userId, missionId);
    expect(signals).toHaveLength(1);
  });
});

describe("missionService — Mission Journey (Sprint-019)", () => {
  let userId: string;

  beforeEach(async () => {
    userId = (await createTestUser()).id;
  });

  afterEach(async () => {
    await deleteTestUser(userId);
  });

  it("decisions[].number is sequential starting at 1 across multiple Decisions", async () => {
    const { missionId } = await missionService.createMission(userId, TASK_INPUT);
    let decisionId = (await missionService.getMissionSummary(userId, missionId))!.activeDecision!.id;
    await produceVerdict(userId, decisionId);
    await decisionService.resolveDecision(userId, decisionId, { outcome: "accepted" });
    await missionService.addMissionUpdate(userId, missionId, TASK_INPUT_2);

    decisionId = (await missionService.getMissionSummary(userId, missionId))!.activeDecision!.id;
    await produceVerdict(userId, decisionId);
    await decisionService.resolveDecision(userId, decisionId, { outcome: "accepted" });
    await missionService.addMissionUpdate(userId, missionId, TASK_INPUT_3);

    const summary = await missionService.getMissionSummary(userId, missionId);
    expect(summary?.decisions.map((decision) => decision.number)).toEqual([1, 2, 3]);
  });

  it("currentFocus reflects the newest Decision regardless of open/resolved state — branch B (Case A)", async () => {
    const { missionId } = await missionService.createMission(userId, TASK_INPUT);
    const decisionId = (await missionService.getMissionSummary(userId, missionId))!.activeDecision!.id;
    await produceVerdict(userId, decisionId);
    await decisionService.resolveDecision(userId, decisionId, { outcome: "accepted" });

    // No new Decision has started yet — currentFocus must show the just-
    // resolved Decision's "done" headline, not a fresh "gettingStarted" one.
    const summary = await missionService.getMissionSummary(userId, missionId);
    expect(summary?.activeDecision).toBeNull();
    expect(summary?.currentFocus.headline).toEqual({ key: "mission.currentFocus.doneAccepted" });
  });

  it("the aggregated timeline preserves every Decision's own history in order", async () => {
    const { missionId } = await missionService.createMission(userId, TASK_INPUT);
    const firstDecisionId = (await missionService.getMissionSummary(userId, missionId))!.activeDecision!.id;
    await missionService.addMissionUpdate(userId, missionId, "One more detail: make it a big shop tomorrow");
    await produceVerdict(userId, firstDecisionId);
    await decisionService.resolveDecision(userId, firstDecisionId, { outcome: "accepted" });
    await missionService.addMissionUpdate(userId, missionId, TASK_INPUT_2);

    const summary = await missionService.getMissionSummary(userId, missionId);
    // 2 "update" entries + 1 "resolution" entry from Decision 1, then 1
    // "update" entry from Decision 2 — concatenated, oldest first.
    expect(summary?.timeline.map((entry) => entry.kind)).toEqual(["update", "update", "resolution", "update"]);
  });

  it("isActive/activeDecision detection is correct across branch A (open), branch B (next started), and branch C (legacy backfill)", async () => {
    // Branch A: an open Decision exists.
    const { missionId: missionA } = await missionService.createMission(userId, TASK_INPUT);
    const summaryA = await missionService.getMissionSummary(userId, missionA);
    expect(summaryA?.activeDecision).not.toBeNull();
    expect(summaryA?.decisions[0].isActive).toBe(true);

    // Branch B: the Mission's last Decision is resolved, none currently open.
    const decisionIdA = summaryA!.activeDecision!.id;
    await produceVerdict(userId, decisionIdA);
    await decisionService.resolveDecision(userId, decisionIdA, { outcome: "accepted" });
    const summaryBBefore = await missionService.getMissionSummary(userId, missionA);
    expect(summaryBBefore?.activeDecision).toBeNull();
    expect(summaryBBefore?.decisions[0].isActive).toBe(false);

    await missionService.addMissionUpdate(userId, missionA, TASK_INPUT_2);
    const summaryBAfter = await missionService.getMissionSummary(userId, missionA);
    expect(summaryBAfter?.activeDecision).not.toBeNull();
    expect(summaryBAfter?.decisions[0].isActive).toBe(false);
    expect(summaryBAfter?.decisions[1].isActive).toBe(true);

    // Branch C: a legacy (pre-Sprint-003) Mission with zero Decisions ever —
    // an orphaned AxisRequest with no decisionId, simulating data that
    // predates Decision existing. Constructed via direct Prisma writes
    // (there's no service-layer path that produces this shape today), not a
    // mock — it's exactly the persisted state the legacy-backfill code path
    // (`decisionService.ensureDecisionForMission`) is written to repair.
    const legacyMission = await prisma.mission.create({ data: { userId, goal: "legacy goal" } });
    await prisma.axisRequest.create({
      data: {
        userId,
        missionId: legacyMission.id,
        rawInput: "legacy request",
        status: "PARSED",
        intent: "unknown",
        module: "unknown",
        confidence: 0.3,
      },
    });

    const summaryC = await missionService.getMissionSummary(userId, legacyMission.id);
    expect(summaryC?.decisions).toHaveLength(1);
    expect(summaryC?.activeDecision?.id).toBe(summaryC?.decisions[0].id);

    const reparentedRequests = await prisma.axisRequest.findMany({ where: { missionId: legacyMission.id } });
    expect(reparentedRequests[0].decisionId).toBe(summaryC?.decisions[0].id);
  });
});

describe("missionService — terminal transition concurrency (Sprint-020/021/022)", () => {
  let userId: string;

  beforeEach(async () => {
    userId = (await createTestUser()).id;
  });

  afterEach(async () => {
    await deleteTestUser(userId);
  });

  it("two concurrent setMissionStatus calls against the same ACTIVE Mission produce exactly one winner, one archived Decision, and one Learning Signal", async () => {
    const { missionId } = await missionService.createMission(userId, TASK_INPUT);
    const decisionId = (await missionService.getMissionSummary(userId, missionId))!.activeDecision!.id;

    const [a, b] = await Promise.allSettled([
      missionService.setMissionStatus(userId, missionId, "COMPLETED"),
      missionService.setMissionStatus(userId, missionId, "ABANDONED"),
    ]);

    const fulfilled = [a, b].filter((result) => result.status === "fulfilled");
    const rejected = [a, b].filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(missionService.MissionAlreadyTerminalError);

    const mission = await prisma.mission.findUnique({ where: { id: missionId } });
    expect(["COMPLETED", "ABANDONED"]).toContain(mission?.status);
    expect(mission?.outcomeAt).not.toBeNull();

    const decision = await decisionRepository.getDecisionById(userId, decisionId);
    expect(decision?.status).toBe("ARCHIVED");

    const signals = await signalsForMission(userId, missionId);
    expect(signals).toHaveLength(1);
  });
});
