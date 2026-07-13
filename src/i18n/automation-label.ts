import type { AutomationLevel } from "@/brain/planning/types";

type Translator = (key: string) => string;

export function automationLabel(t: Translator, level: AutomationLevel): string {
  switch (level) {
    case "manual":
      return t("automation.manual");
    case "assisted":
      return t("automation.assisted");
    case "automatic":
      return t("automation.automatic");
  }
}
