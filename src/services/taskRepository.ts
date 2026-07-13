import { prisma } from "@/lib/prisma";

export interface TaskRow {
  id: string;
  userId: string;
  axisRequestId: string | null;
  title: string;
  description: string | null;
  status: string;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Persists a real `Task` row (Sprint-025, RFC-0003 §9 `create_task`) —
 * mirrors `documentRepository.createDocument` exactly. `description` is
 * always null this sprint (nothing upstream extracts one yet); the field
 * exists on the row for forward-compat with the schema, not because this
 * sprint populates it. */
async function createTask(
  userId: string,
  title: string,
  dueDate: Date | undefined,
  axisRequestId: string,
): Promise<TaskRow> {
  return prisma.task.create({ data: { userId, title, dueDate: dueDate ?? null, axisRequestId } });
}

export const taskRepository = { createTask };
