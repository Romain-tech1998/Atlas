import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { documentRepository } from "@/services/documentRepository";
import { DocumentsBrowser } from "@/components/documents/documents-browser";
import { DocumentSemanticSearch } from "@/components/documents/document-semantic-search";

/**
 * Sprint-010 introduced this page as a plain first-20-rows list. Sprint-013
 * brings it up to the browsing standard Sprint-012 already built for the
 * Evidence pickers: search, "Load more", and empty/no-results states — all
 * via `DocumentsBrowser`, the same shared `usePaginatedSearch` primitive
 * `InternalEvidenceBrowser` uses. Only the first page is server-rendered
 * here; the browser fetches further pages itself via `/api/documents`.
 */
export default async function DocumentsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const [{ items, hasMore }, t] = await Promise.all([
    documentRepository.listDocuments(session.user.id),
    getTranslations("documents"),
  ]);

  const initialPage = {
    items: items.map((document) => ({
      id: document.id,
      title: document.title,
      content: document.content,
      createdAt: document.createdAt.toISOString(),
    })),
    hasMore,
  };

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      <DocumentSemanticSearch />

      <DocumentsBrowser initialPage={initialPage} />
    </main>
  );
}
