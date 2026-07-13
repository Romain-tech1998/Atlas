import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { atlasBrain } from "@/services/atlasBrain";
import { resolveDueDateKeyword } from "@/domain/due-date";
import { createTestUser, deleteTestUser } from "@/test/helpers";

/** Deterministic raw-input strings, chosen by reading the actual rules in
 * `src/brain/intent/intentEngine.ts` / `src/brain/entity/entityEngine.ts` /
 * `src/brain/planning/planningEngine.ts` — same discipline
 * `missionService.test.ts` already established, not a guessed phrase. */
const TASK_WITH_DUE_DATE = "I need to buy groceries tomorrow";
const TASK_WITHOUT_DUE_DATE = "I need to buy groceries";
const DOCUMENT_INPUT = "write down remember to water the plants";

describe("atlasBrain.runPipeline — create_task Skill (Sprint-025, RFC-0003 §9)", () => {
  let userId: string;

  beforeEach(async () => {
    userId = (await createTestUser()).id;
  });

  afterEach(async () => {
    await deleteTestUser(userId);
  });

  it("a task-routed input with a resolvable due-date keyword creates a real Task row", async () => {
    await atlasBrain.runPipeline(userId, TASK_WITH_DUE_DATE);

    const tasks = await prisma.task.findMany({ where: { userId } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("buy groceries tomorrow");
    expect(tasks[0].dueDate).toEqual(resolveDueDateKeyword("tomorrow", new Date()));
  });

  it("a task-routed input with no due-date keyword stays 'assisted' and creates no Task row", async () => {
    const result = await atlasBrain.runPipeline(userId, TASK_WITHOUT_DUE_DATE);

    expect(result.plan.automationLevel).toBe("assisted");
    expect(result.plan.missingInfo).toContain("dueDate");

    const tasks = await prisma.task.findMany({ where: { userId } });
    expect(tasks).toHaveLength(0);
  });

  // The mirror of this test for `document` ("assisted creates nothing") is
  // not reachable: `planningEngine.draftStepsForModule`'s `document` branch
  // always returns `missingInfo: []`, so a document-routed request's
  // `automationLevel` is unconditionally "automatic" — there is no assisted
  // document state to lock down. Verified here instead: the existing
  // `save_document` gate (Sprint-010) still creates a real Document row
  // through the full pipeline, since no test exercised it end-to-end before
  // this sprint either.
  it("a document-routed input still creates a real Document row through the full pipeline", async () => {
    await atlasBrain.runPipeline(userId, DOCUMENT_INPUT);

    const documents = await prisma.document.findMany({ where: { userId } });
    expect(documents).toHaveLength(1);
    expect(documents[0].content).toBe(DOCUMENT_INPUT);
  });
});
