import type { Skill } from "@/skills/skillEngine";
import { documentRepository } from "@/services/documentRepository";

/**
 * RFC-0003 §9 `save_document` input: deliberately narrow. `content` is the
 * raw request text, verbatim — never extracted, summarized, or OCR'd. No
 * NLP for this Skill, same discipline as `find_lowest_value`'s
 * Evidence-only diet (Sprint-006).
 */
export interface SaveDocumentInput {
  title: string;
  content: string;
}

export interface SaveDocumentOutput {
  documentId: string;
}

/**
 * The second Skill Atlas ever executes (after `find_lowest_value`,
 * Sprint-006) and the first with `sideEffects: "write"` — the permission
 * gate RFC-0003 §6 already specified ("a write Skill only runs if... the
 * `ExecutionPlan` was already scored at an automation level that's been
 * explicitly trusted") is enforced by the caller (`atlasBrain.runPipeline`)
 * *before* ever constructing this Skill, not inside it — see that call
 * site for the exact gate condition.
 *
 * `userId`/`axisRequestId` are deliberately not part of the Skill's
 * input/output contract (RFC-0003 §9 specifies exactly `{title, content}`
 * -> `{documentId}`) — they're the ambient context of one specific call,
 * not data the caller is choosing or varying. So this is a factory that
 * builds one fresh, single-use `Skill` instance closing over them, rather
 * than a stateless singleton like `find_lowest_value`. Still exactly one
 * explicit call site, not a registry — `runSkill` remains the same bare
 * synchronous dispatcher from Sprint-006; `run` here simply returns a
 * `Promise` (a real database write can't be synchronous), which fits the
 * existing `Skill<TInput, TOutput>` shape without changing it — `TOutput`
 * is just instantiated as `Promise<SaveDocumentOutput>` for this one Skill.
 */
export function createSaveDocumentSkill(
  userId: string,
  axisRequestId: string,
): Skill<SaveDocumentInput, Promise<SaveDocumentOutput>> {
  return {
    id: "save_document",
    sideEffects: "write",
    async run(input) {
      const document = await documentRepository.createDocument(userId, input.title, input.content, axisRequestId);
      return { documentId: document.id };
    },
  };
}
