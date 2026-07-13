import type { Provider } from "@/providers/provider";

/**
 * RFC-0003 §8b: an in-memory registry that only registers and looks up,
 * nothing more — the same restraint as the Skill Engine itself
 * (`src/skills/skillEngine.ts`). No lifecycle, no dependency injection, no
 * plugin loading, no discovery. `registerProvider` overwrites by id
 * (`Map.set`), so it's idempotent by construction — safe to call on every
 * request without a guard.
 */
const providers = new Map<string, Provider>();

export function registerProvider(provider: Provider): void {
  providers.set(provider.id, provider);
}

/** Typed lookup for a Skill's own factory to resolve its Provider by id
 * (e.g. `getProvider<CalendarProvider>(providerId)` inside
 * `createReadCalendarSkill`) — never injected by a caller, never resolved
 * by Atlas Brain. */
export function getProvider<T extends Provider = Provider>(id: string): T | undefined {
  return providers.get(id) as T | undefined;
}

export function listProviders(): Provider[] {
  return [...providers.values()];
}
