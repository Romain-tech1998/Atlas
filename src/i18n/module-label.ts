import type { AxisModuleId } from "@/domain/axis";

type Translator = (key: string) => string;

/** Static key lookup — avoids computed-string translation keys, which
 * don't type-check against next-intl's strict message types. */
export function moduleLabel(t: Translator, moduleId: AxisModuleId): string {
  switch (moduleId) {
    case "task":
      return t("modules.task");
    case "memory":
      return t("modules.memory");
    case "document":
      return t("modules.document");
    case "shopping":
      return t("modules.shopping");
    case "travel":
      return t("modules.travel");
    case "conversation":
      return t("modules.conversation");
    case "unknown":
      return t("modules.unknown");
  }
}

/** Same domains as AxisModuleId, minus "unknown" (Atlas State never tracks
 * that as an active domain — see atlasStateEngine.bumpDomain). Falls back
 * to the raw id for forward-compat if that ever changes. */
export function domainLabel(t: Translator, domainId: string): string {
  if (
    domainId === "task" ||
    domainId === "memory" ||
    domainId === "document" ||
    domainId === "conversation" ||
    domainId === "shopping" ||
    domainId === "travel"
  ) {
    return moduleLabel(t, domainId);
  }
  return domainId;
}
