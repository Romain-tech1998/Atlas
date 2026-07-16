"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePaginatedSearch, type SearchPage } from "@/hooks/use-paginated-search";

const PREVIEW_LENGTH = 200;

/** The first N characters, verbatim — not a summary, not "smart"
 * truncation (Sprint-010's original convention on this page, unchanged).
 * Exported for `DocumentSemanticSearch` (Sprint-035) to reuse the same
 * preview convention for its matched-Document cards. */
export function previewContent(content: string): string {
  return content.length > PREVIEW_LENGTH ? `${content.slice(0, PREVIEW_LENGTH)}…` : content;
}

export interface BrowsableDocument {
  id: string;
  title: string;
  content: string;
  /** ISO string — same server->client convention as `AttachableDocument`
   * (Sprint-009/011), so this stays a plain, predictable prop type. */
  createdAt: string;
}

interface DocumentsBrowserProps {
  initialPage: SearchPage<BrowsableDocument>;
}

async function fetchDocumentsPage({
  query,
  offset,
}: {
  query: string;
  offset: number;
}): Promise<SearchPage<BrowsableDocument>> {
  const params = new URLSearchParams();
  if (query.trim().length > 0) params.set("query", query.trim());
  params.set("offset", String(offset));

  const response = await fetch(`/api/documents?${params.toString()}`);
  if (!response.ok) return { items: [], hasMore: false };
  return response.json();
}

/**
 * Sprint-013: the Documents library's own thin wrapper around the shared
 * `usePaginatedSearch` primitive (the same one `InternalEvidenceBrowser`
 * uses) — deliberately not `InternalEvidenceBrowser` itself, since that
 * component's shape ends in select → preview → confirm-attach (an Evidence
 * concept with no equivalent here). A library row's only terminal action is
 * opening `/documents/[id]` — there's nothing to "attach" a Document to.
 */
export function DocumentsBrowser({ initialPage }: DocumentsBrowserProps) {
  const t = useTranslations("documents");
  const { query, onQueryChange, page, isLoading, loadMore, hasQuery } = usePaginatedSearch(
    fetchDocumentsPage,
    initialPage,
  );

  const showEmptyState = page.items.length === 0 && !hasQuery;
  const showNoResults = page.items.length === 0 && hasQuery;

  return (
    <div className="flex flex-col gap-4">
      <input
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={t("searchPlaceholder")}
        className="border-input h-9 rounded-lg border bg-transparent px-3 text-sm"
      />

      {showEmptyState ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : showNoResults ? (
        <p className="text-muted-foreground text-sm">{t("noResults")}</p>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {page.items.map((document) => (
              <Link key={document.id} href={`/documents/${document.id}`} className="block">
                <Card className="hover:bg-muted/40 transition-colors">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{document.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    <p className="text-sm whitespace-pre-wrap">{previewContent(document.content)}</p>
                    <p className="text-muted-foreground text-xs">
                      {t("createdAt", { date: new Date(document.createdAt).toLocaleDateString() })}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
          {page.hasMore ? (
            <Button type="button" variant="ghost" size="sm" disabled={isLoading} onClick={loadMore}>
              {isLoading ? t("loading") : t("loadMore")}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
