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

/** Claude Design "Projet atlas" tokens — a colored dot + uppercase label
 * per module (ModuleBadge). A `switch`, not an `if`-chain, so the compiler
 * forces every future AxisModuleId to get a color, the same discipline
 * moduleLabel already follows (Sprint-030/033 learned domainLabel's
 * manual `if`-chain does not give this guarantee). `unknown` has no
 * assigned identity color — not a real user-facing module, so it renders
 * without a dot rather than inventing a 7th color for it. */
export function moduleColor(moduleId: AxisModuleId): string | null {
  switch (moduleId) {
    case "shopping":
      return "#9C5430";
    case "travel":
      return "#5B6B4F";
    case "task":
      return "#B08A3E";
    case "document":
      return "#5B6B79";
    case "memory":
      return "#7A5566";
    case "conversation":
      return "#8C6A46";
    case "unknown":
      return null;
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
