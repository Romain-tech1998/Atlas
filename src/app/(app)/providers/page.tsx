import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { registerDefaultProviders } from "@/providers/registerDefaultProviders";
import { listProviders } from "@/providers/providerRegistry";
import type { Provider, ProviderStatus } from "@/providers/provider";
import { mockCalendarProvider } from "@/providers/mock-calendar-provider";
import { createGoogleCalendarProvider } from "@/providers/google-calendar-provider";
import { createReadCalendarSkill, type ReadCalendarOutput } from "@/skills/read-calendar";
import { createReadWeatherSkill, type ReadWeatherOutput } from "@/skills/read-weather";
import { OPEN_METEO_PROVIDER_ID } from "@/providers/open-meteo-provider";
import { runSkill } from "@/skills/skillEngine";
import { GOOGLE_CALENDAR_PROVIDER_ID } from "@/services/googleCalendarConnectionService";
import { externalConnectionRepository } from "@/services/externalConnectionRepository";
import { userLocationRepository } from "@/services/userLocationRepository";
import type { ExternalConnectionStatus } from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Sprint-015 (RFC-0003 §8c): upgrades Sprint-014's read-only demo into
 * Atlas's first real external connection. `Provider.status` is present only
 * for Mock (one static, global value); Google's Registry entry has no
 * `status` at all — its connection state is per-user and resolved here from
 * `ExternalConnection`, never stored on or read from the Registry. This
 * page is still the one call site for `read_calendar`, now invoked twice:
 * once against the shared `mockCalendarProvider` instance, and — only when
 * Google is connected — once against a fresh, user-bound
 * `createGoogleCalendarProvider(userId)` instance. Atlas Brain is untouched.
 */
function resolveGoogleStatus(status: ExternalConnectionStatus | undefined): ProviderStatus {
  if (status === "CONNECTED") return "connected";
  if (status === "ERROR") return "unavailable";
  return "disconnected";
}

export default async function ProvidersPage(props: PageProps<"/providers">) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const userId = session.user.id;

  registerDefaultProviders();
  const providers = listProviders();

  const googleConnection = await externalConnectionRepository.getExternalConnection(
    userId,
    GOOGLE_CALENDAR_PROVIDER_ID,
  );
  const googleStatus = resolveGoogleStatus(googleConnection?.status);

  const resolvedProviders: Array<Provider & { resolvedStatus: ProviderStatus }> = providers.map((provider) => ({
    ...provider,
    resolvedStatus: provider.status ?? (provider.id === GOOGLE_CALENDAR_PROVIDER_ID ? googleStatus : "disconnected"),
  }));

  const mockResult = await runSkill(createReadCalendarSkill(mockCalendarProvider), {});

  let googleResult: ReadCalendarOutput | null = null;
  if (googleStatus === "connected") {
    googleResult = await runSkill(createReadCalendarSkill(createGoogleCalendarProvider(userId)), {});
  }

  const location = await userLocationRepository.getLocation(userId);
  const weatherResult = location
    ? await runSkill(createReadWeatherSkill(OPEN_METEO_PROVIDER_ID), {
        latitude: location.latitude,
        longitude: location.longitude,
      })
    : null;

  const t = await getTranslations("providers");
  const searchParams = await props.searchParams;
  const notice = firstParam(searchParams?.googleCalendarNotice);
  const error = firstParam(searchParams?.googleCalendarError);
  const success = firstParam(searchParams?.googleCalendarSuccess);
  const locationError = firstParam(searchParams?.locationError);
  const locationSuccess = firstParam(searchParams?.locationSuccess);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
        <p className="text-muted-foreground mt-1 text-xs">{t("readOnlyNote")}</p>
      </div>

      {notice === "cancelled" && <Banner tone="neutral">{t("notices.cancelled")}</Banner>}
      {success === "1" && <Banner tone="positive">{t("notices.success")}</Banner>}
      {error === "config" && <Banner tone="negative">{t("errors.config")}</Banner>}
      {(error === "state" || error === "missing_code") && <Banner tone="negative">{t("errors.state")}</Banner>}
      {error === "exchange_failed" && <Banner tone="negative">{t("errors.exchangeFailed")}</Banner>}

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-3 font-medium">{t("columns.name")}</th>
                <th className="p-3 font-medium">{t("columns.id")}</th>
                <th className="p-3 font-medium">{t("columns.status")}</th>
                <th className="p-3 font-medium">{t("columns.authType")}</th>
                <th className="p-3 font-medium">{t("columns.capabilities")}</th>
                <th className="p-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {resolvedProviders.map((provider) => (
                <tr key={provider.id} className="border-b last:border-0">
                  <td className="p-3">{provider.name}</td>
                  <td className="text-muted-foreground p-3">{provider.id}</td>
                  <td className="p-3">
                    <Badge variant="secondary">{t(`status.${provider.resolvedStatus}`)}</Badge>
                  </td>
                  <td className="p-3">{provider.authType}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {provider.capabilities.map((capability) => (
                        <Badge key={capability} variant="outline" className="text-xs font-normal">
                          {capability}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="p-3 text-right">
                    {provider.id === GOOGLE_CALENDAR_PROVIDER_ID && (
                      <GoogleConnectionControl status={provider.resolvedStatus} t={t} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {googleStatus === "connected" && googleResult && (
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="font-heading text-lg font-medium">{t("googleCalendar.sectionTitle")}</h2>
            <p className="text-muted-foreground text-xs">{t("googleCalendar.liveDataLabel")}</p>
          </div>
          <EventListOrError result={googleResult} t={t} />
        </div>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-medium">{t("mockCalendar.sectionTitle")}</h2>
        <EventListOrError result={mockResult} t={t} />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-medium">{t("weather.sectionTitle")}</h2>

        <form action="/api/user-location" method="POST" className="flex gap-2">
          <input
            name="city"
            placeholder={t("weather.locationForm.placeholder")}
            defaultValue={location?.city ?? ""}
            className="rounded-md border px-2 py-1 text-sm"
          />
          <Button type="submit" size="sm">
            {t("weather.locationForm.submit")}
          </Button>
        </form>

        {locationError === "not_found" && <Banner tone="negative">{t("weather.locationForm.notFound")}</Banner>}
        {locationError === "unavailable" && <Banner tone="negative">{t("weather.locationForm.unavailable")}</Banner>}
        {locationError === "empty" && <Banner tone="negative">{t("weather.locationForm.empty")}</Banner>}
        {locationSuccess === "1" && <Banner tone="positive">{t("weather.locationForm.success")}</Banner>}

        {location ? (
          <>
            <p className="text-muted-foreground text-xs">{t("weather.currentLocation", { city: location.city })}</p>
            {weatherResult && <WeatherOrError result={weatherResult} t={t} />}
          </>
        ) : (
          <p className="text-muted-foreground text-sm">{t("weather.noLocation")}</p>
        )}
      </div>
    </main>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

type Translator = Awaited<ReturnType<typeof getTranslations>>;

function GoogleConnectionControl({ status, t }: { status: ProviderStatus; t: Translator }) {
  if (status === "connected") {
    return (
      <form action="/api/providers/google-calendar/disconnect" method="POST">
        <Button type="submit" variant="outline" size="sm">
          {t("actions.disconnect")}
        </Button>
      </form>
    );
  }

  return (
    <Button variant="default" size="sm" render={<a href="/api/providers/google-calendar/connect" />}>
      {t("actions.connect")}
    </Button>
  );
}

function EventListOrError({ result, t }: { result: ReadCalendarOutput; t: Translator }) {
  if ("error" in result) {
    return (
      <p className="text-muted-foreground text-sm">
        {result.error.code === "unauthorized" ? t("events.reconnectRequired") : t("events.unavailable")}
      </p>
    );
  }

  if (result.events.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("events.empty")}</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {result.events.map((event) => (
        <li key={event.id} className="rounded-lg border px-3 py-2 text-sm">
          <p>{event.title || t("events.untitled")}</p>
          <p className="text-muted-foreground text-xs">
            {event.allDay ? event.start : new Date(event.start).toLocaleString()}
          </p>
        </li>
      ))}
    </ul>
  );
}

function WeatherOrError({ result, t }: { result: ReadWeatherOutput; t: Translator }) {
  if ("error" in result) {
    return <p className="text-muted-foreground text-sm">{t("weather.unavailable")}</p>;
  }
  const { temperatureC, windSpeedKmh } = result.weather;
  return (
    <p className="text-sm">
      {t("weather.reading", { temperatureC: Math.round(temperatureC), windSpeedKmh: Math.round(windSpeedKmh) })}
    </p>
  );
}

function Banner({ tone, children }: { tone: "positive" | "negative" | "neutral"; children: React.ReactNode }) {
  const toneClass =
    tone === "positive"
      ? "border-green-600/30 bg-green-600/10 text-green-700 dark:text-green-400"
      : tone === "negative"
        ? "border-destructive/30 bg-destructive/10 text-destructive"
        : "border-border bg-muted text-muted-foreground";

  return <div className={`rounded-lg border px-3 py-2 text-sm ${toneClass}`}>{children}</div>;
}
