import type { Skill } from "@/skills/skillEngine";
import { taskRepository } from "@/services/taskRepository";

/** RFC-0003 §9 `create_task` input, narrowed to what this sprint actually
 * has a source for: `title` (from entityEngine) and a resolved `dueDate`
 * (from `resolveDueDateKeyword`, called by the caller before constructing
 * this input — the Skill itself does no keyword parsing, same "Skill only
 * persists, caller resolves" split `save_document` uses for `content`).
 * `description` is part of RFC-0003's spec but is not included here —
 * nothing upstream of this Skill extracts one yet. */
export interface CreateTaskInput {
  title: string;
  dueDate?: Date;
}

export interface CreateTaskOutput {
  taskId: string;
}

/**
 * The third Skill Atlas ever executes and the second with `sideEffects:
 * "write"` (after `save_document`, Sprint-010) — same factory-closure
 * shape, same permission gate enforced by the caller
 * (`atlasBrain.runPipeline`) before this Skill is ever constructed, not
 * inside it.
 */
export function createCreateTaskSkill(
  userId: string,
  axisRequestId: string,
): Skill<CreateTaskInput, Promise<CreateTaskOutput>> {
  return {
    id: "create_task",
    sideEffects: "write",
    async run(input) {
      const task = await taskRepository.createTask(userId, input.title, input.dueDate, axisRequestId);
      return { taskId: task.id };
    },
  };
}
