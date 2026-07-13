import { getTranslations } from "next-intl/server";

interface MissionWhyProps {
  reasoning: string;
  isFirstUpdate: boolean;
}

/** Short, human explanation of why the Current Focus is what it is. Uses
 * the routing reasoning Atlas Brain already computes — never invents a
 * causal story it doesn't actually have. */
export async function MissionWhy({ reasoning, isFirstUpdate }: MissionWhyProps) {
  const t = await getTranslations("mission.why");

  return (
    <p className="text-muted-foreground text-sm">
      <span className="text-foreground/80 font-medium">{t("label")}</span>
      {reasoning} {isFirstUpdate ? t("kicksOff") : t("pickingUp")}
    </p>
  );
}
