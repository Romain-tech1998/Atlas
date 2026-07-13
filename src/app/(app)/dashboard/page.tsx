import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { atlasBrain } from "@/services/atlasBrain";
import { AxisResultCard } from "@/components/axis/axis-result-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { renderLocalized } from "@/i18n/render";
import { domainLabel, moduleLabel } from "@/i18n/module-label";
import { automationLabel } from "@/i18n/automation-label";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const [stats, recentRequests] = await Promise.all([
    atlasBrain.getDashboardStats(session.user.id),
    atlasBrain.getRecentRequests(session.user.id, 5),
  ]);
  const t = await getTranslations();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("dashboard.title")}</h1>
        <p className="text-muted-foreground">{t("dashboard.subtitle")}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">{t("dashboard.axisRequests")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{stats.totalRequests}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">{t("dashboard.avgConfidence")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{Math.round(stats.averageConfidence * 100)}%</p>
          </CardContent>
        </Card>
        <Card className="col-span-2 sm:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">{t("dashboard.mostActiveDomains")}</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.mostActiveDomains.length === 0 ? (
              <p className="text-muted-foreground text-sm">—</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {stats.mostActiveDomains.slice(0, 5).map((domain) => (
                  <li key={domain.domain} className="flex justify-between">
                    <span>{domainLabel(t, domain.domain)}</span>
                    <span className="font-medium">{domain.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card className="col-span-2 sm:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">{t("dashboard.mostSuggestedModules")}</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.mostSuggestedModules.length === 0 ? (
              <p className="text-muted-foreground text-sm">—</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {stats.mostSuggestedModules.slice(0, 5).map((moduleStat) => (
                  <li key={moduleStat.module} className="flex justify-between">
                    <span>{moduleLabel(t, moduleStat.module)}</span>
                    <span className="font-medium">{moduleStat.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("dashboard.latestPlans")}</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.latestPlans.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("dashboard.noPlansYet")}</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {stats.latestPlans.map((plan) => (
                <li key={plan.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{renderLocalized(t, plan.summary)}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-muted-foreground">
                      {t("dashboard.stepsCount", { count: plan.stepsCount })}
                    </span>
                    <Badge variant="secondary">{automationLabel(t, plan.automationLevel)}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">{t("dashboard.recentRequests")}</h2>
        {recentRequests.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("dashboard.nothingYet")}</p>
        ) : (
          recentRequests.map((result) => <AxisResultCard key={result.id} result={result} />)
        )}
      </div>
    </main>
  );
}
