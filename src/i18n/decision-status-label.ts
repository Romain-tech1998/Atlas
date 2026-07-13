import type { DecisionStatusId } from "@/domain/decision";

type Translator = (key: string) => string;

/** Static key lookup — avoids computed-string translation keys, which
 * don't type-check against next-intl's strict message types. */
export function decisionStatusLabel(t: Translator, status: DecisionStatusId): string {
  switch (status) {
    case "OPEN":
      return t("decision.status.open");
    case "COLLECTING_INFORMATION":
      return t("decision.status.collectingInformation");
    case "REASONING":
      return t("decision.status.reasoning");
    case "READY":
      return t("decision.status.ready");
    case "RESOLVED":
      return t("decision.status.resolved");
    case "ARCHIVED":
      return t("decision.status.archived");
  }
}
