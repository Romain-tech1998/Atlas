import type { MissionStatusId } from "@/domain/mission";

type Translator = (key: string) => string;

/** Static key lookup — avoids computed-string translation keys, which
 * don't type-check against next-intl's strict message types. */
export function missionStatusLabel(t: Translator, status: MissionStatusId): string {
  switch (status) {
    case "ACTIVE":
      return t("mission.status.active");
    case "COMPLETED":
      return t("mission.status.completed");
    case "ABANDONED":
      return t("mission.status.abandoned");
  }
}
