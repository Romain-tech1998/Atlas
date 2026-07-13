import type { IntentResult } from "@/brain/intent/types";
import type { EntityResult } from "@/brain/entity/types";
import type { AtlasStateSnapshot } from "./types";

const EMPTY_STATE: AtlasStateSnapshot = {
  activeDomains: {},
  priorities: [],
  preferences: {},
  activeProjects: [],
  openTaskCount: 0,
};

const MAX_PRIORITIES = 10;
const MAX_ACTIVE_PROJECTS = 5;

function bumpDomain(activeDomains: Record<string, number>, module: string): Record<string, number> {
  if (module === "unknown") return activeDomains;
  return { ...activeDomains, [module]: (activeDomains[module] ?? 0) + 1 };
}

function mergePriorities(current: string[], keywords: string[]): string[] {
  const merged = [...keywords, ...current];
  return Array.from(new Set(merged)).slice(0, MAX_PRIORITIES);
}

function mergeActiveProjects(current: string[], title: string): string[] {
  const merged = [title, ...current.filter((project) => project !== title)];
  return merged.slice(0, MAX_ACTIVE_PROJECTS);
}

/**
 * Deterministic Atlas State transition: given the current state (or none,
 * for a first-ever interaction) plus this request's intent and entities,
 * computes the next state. Pure — the repository is responsible for
 * persisting the result and stamping timestamps.
 */
export function computeNextState(
  current: AtlasStateSnapshot | null,
  intent: IntentResult,
  entities: EntityResult,
): AtlasStateSnapshot {
  const base = current ?? EMPTY_STATE;

  const next: AtlasStateSnapshot = {
    activeDomains: bumpDomain(base.activeDomains, intent.module),
    priorities: mergePriorities(base.priorities, entities.keywords),
    preferences: base.preferences,
    activeProjects: base.activeProjects,
    openTaskCount: base.openTaskCount,
  };

  if (intent.module === "memory" && entities.keywords[0]) {
    next.preferences = { ...base.preferences, [entities.keywords[0]]: entities.title };
  }

  if (intent.module === "document") {
    next.activeProjects = mergeActiveProjects(base.activeProjects, entities.title);
  }

  if (intent.module === "task") {
    next.openTaskCount = base.openTaskCount + 1;
  }

  return next;
}

export const atlasStateEngine = { computeNextState };
