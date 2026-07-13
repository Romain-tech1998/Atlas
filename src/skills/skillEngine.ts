/**
 * RFC-0003 §2/§8a's Skill contract, cut down to exactly the fields
 * `find_lowest_value` (Sprint-006, the first executable Skill) needs —
 * not the full anatomy (`version`, `category`, `requiredPermissions`,
 * `timeout`, `retryPolicy`, observability events, learning signals). Those
 * matter once there's a Skill Planner deciding *which* Skill to run and a
 * registry of many; with exactly one Skill and one explicit call site,
 * building them now would be speculative infrastructure for a planner that
 * doesn't exist yet.
 */
export interface Skill<TInput, TOutput> {
  id: string;
  /** Mandatory per RFC-0003 §6 ("Skills must declare side effects").
   * `"none"` since Sprint-006 (`find_lowest_value`, a pure comparison);
   * `"write"` since Sprint-010 (`save_document`, the first Skill that
   * actually touches the database); `"external"` since Sprint-014
   * (`read_calendar`, the first Skill that resolves a Provider) —
   * RFC-0003 §6's full vocabulary also has `"read"`, added only once a
   * concrete Skill needs it, not speculatively. */
  sideEffects: "none" | "write" | "external";
  run: (input: TInput) => TOutput;
}

/**
 * The Skill Engine (RFC-0003 §1/§8): a single synchronous dispatch
 * function, not a registry — RFC-0003 §8a/§10 resolves the Skill Engine to
 * be synchronous-only for Sprint-006. There is exactly one Skill to run,
 * so there's nothing to look up by id and nothing to plan; this function
 * exists to keep the Skill/Skill-Engine boundary real (a Skill is invoked
 * *through* the engine, never called as a bare function), not to add
 * machinery beyond that.
 */
export function runSkill<TInput, TOutput>(skill: Skill<TInput, TOutput>, input: TInput): TOutput {
  return skill.run(input);
}
