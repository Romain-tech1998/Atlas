import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { documentRepository } from "@/services/documentRepository";

/**
 * Sprint-013: a real detail route, mirroring `/missions/[id]` — the app's
 * one existing precedent for a detail page — rather than an inline
 * expandable view, which nothing else in Atlas uses. Ownership-checked via
 * `getDocumentById` (built in Sprint-011 for `addEvidenceFromDocument`'s
 * lookup, reused here as-is): a missing or not-owned Document 404s, same
 * convention as the Mission detail page. View-only — no editing, no
 * deletion, per this sprint's scope.
 */
export default async function DocumentDetailPage(props: PageProps<"/documents/[id]">) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const { id } = await props.params;
  const [document, t] = await Promise.all([
    documentRepository.getDocumentById(session.user.id, id),
    getTranslations("documents"),
  ]);

  if (!document) {
    notFound();
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{document.title}</h1>
        <p className="text-muted-foreground text-sm">
          {t("createdAt", { date: document.createdAt.toLocaleDateString() })}
        </p>
      </div>
      <p className="text-sm whitespace-pre-wrap">{document.content}</p>
    </main>
  );
}
