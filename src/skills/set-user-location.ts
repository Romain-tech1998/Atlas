import type { Skill } from "@/skills/skillEngine";
import { userLocationRepository } from "@/services/userLocationRepository";

export interface SetUserLocationInput {
  city: string;
  latitude: number;
  longitude: number;
}

export interface SetUserLocationOutput {
  city: string;
}

/** Third write Skill, after `save_document` (Sprint-010) and `create_task`
 * (Sprint-025) — same "Skill only persists, caller already resolved
 * everything" split. This Skill never calls a Provider itself; geocoding
 * already happened in `resolve_location` before this is ever constructed
 * — mirrors `create_task`'s own split from `resolveDueDateKeyword`. No
 * `automationLevel` gate here (unlike `create_task`/`save_document`) —
 * this sprint's caller is a plain API route, not `atlasBrain.runPipeline`,
 * so there is no `ExecutionPlan` to gate against; the gate here is simply
 * "the user explicitly submitted this form." */
export function createSetUserLocationSkill(userId: string): Skill<SetUserLocationInput, Promise<SetUserLocationOutput>> {
  return {
    id: "set_user_location",
    sideEffects: "write",
    async run({ city, latitude, longitude }) {
      const location = await userLocationRepository.upsertLocation(userId, city, latitude, longitude);
      return { city: location.city };
    },
  };
}
