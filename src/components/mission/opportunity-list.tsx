import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { renderLocalized } from "@/i18n/render";
import type { Opportunity } from "@/domain/opportunity";

interface OpportunityListProps {
  opportunities: Opportunity[];
  title: string;
}

export async function OpportunityList({ opportunities, title }: OpportunityListProps) {
  if (opportunities.length === 0) return null;

  const t = await getTranslations();

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">{title}</h2>
      <div className="flex flex-col gap-2">
        {opportunities.map((opportunity) => (
          <Link
            key={opportunity.missionId}
            href={`/missions/${opportunity.missionId}`}
            className="hover:border-foreground/30 block rounded-lg border p-3 text-sm transition-colors"
          >
            <p className="font-medium">{renderLocalized(t, opportunity.missionTitle)}</p>
            <p className="text-muted-foreground mt-0.5">{renderLocalized(t, opportunity.reason)}</p>
            <div className="mt-2 flex items-center gap-2">
              <Badge variant="outline">
                {opportunity.effort === "low" ? t("opportunity.effortLow") : t("opportunity.effortMedium")}
              </Badge>
              <span className="text-muted-foreground text-xs">{renderLocalized(t, opportunity.impact)}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
