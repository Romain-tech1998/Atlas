import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { atlasBrain } from "@/services/atlasBrain";
import { AxisPageClient } from "./axis-page-client";

export default async function AxisPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const initialResults = await atlasBrain.getRecentRequests(session.user.id);
  const t = await getTranslations("axis.page");

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      <AxisPageClient initialResults={initialResults} />
    </main>
  );
}
