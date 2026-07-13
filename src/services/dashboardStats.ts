import type { AxisModuleId } from "@/domain/axis";
import type { AutomationLevel, ExecutionPlan } from "@/brain/planning/types";
import type { LocalizedText } from "@/i18n/message";
import type { DashboardRawData } from "./axisRequestRepository";

export interface DomainActivity {
  domain: string;
  count: number;
}

export interface ModuleSuggestionCount {
  module: AxisModuleId;
  count: number;
}

export interface RecentPlanSummary {
  id: string;
  summary: LocalizedText;
  stepsCount: number;
  automationLevel: AutomationLevel;
  createdAt: string;
}

export interface DashboardStats {
  totalRequests: number;
  averageConfidence: number;
  mostActiveDomains: DomainActivity[];
  mostSuggestedModules: ModuleSuggestionCount[];
  latestPlans: RecentPlanSummary[];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function rankDomains(activeDomains: Record<string, number>): DomainActivity[] {
  return Object.entries(activeDomains)
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count);
}

function rankSuggestedModules(suggestedModuleLists: string[][]): ModuleSuggestionCount[] {
  const counts = new Map<string, number>();
  for (const modules of suggestedModuleLists) {
    for (const moduleId of modules) {
      counts.set(moduleId, (counts.get(moduleId) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([moduleId, count]) => ({ module: moduleId as AxisModuleId, count }))
    .sort((a, b) => b.count - a.count);
}

function summarizePlans(latestPlans: DashboardRawData["latestPlans"]): RecentPlanSummary[] {
  return latestPlans.map((row) => {
    const plan = row.executionPlan as unknown as ExecutionPlan | null;
    return {
      id: row.id,
      summary: row.summary,
      stepsCount: plan?.steps.length ?? 0,
      automationLevel: plan?.automationLevel ?? "manual",
      createdAt: row.createdAt.toISOString(),
    };
  });
}

/** Pure computation of dashboard aggregates from already-fetched rows. */
export function computeDashboardStats(raw: DashboardRawData): DashboardStats {
  return {
    totalRequests: raw.totalRequests,
    averageConfidence: raw.averageConfidence !== null ? round(raw.averageConfidence) : 0,
    mostActiveDomains: rankDomains(raw.activeDomains),
    mostSuggestedModules: rankSuggestedModules(raw.suggestedModuleLists),
    latestPlans: summarizePlans(raw.latestPlans),
  };
}
