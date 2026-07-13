"use client";

import { Button } from "@/components/ui/button";
import { usePaginatedSearch, type SearchPage } from "@/hooks/use-paginated-search";

/** Re-exported for existing callers (`evidence-form.tsx`) — same shape as
 * the shared hook's `SearchPage`, kept as its own name here since this
 * component's public contract predates the Sprint-013 extraction and
 * callers shouldn't need to change their imports for an internal refactor. */
export type BrowserPage<T> = SearchPage<T>;

interface InternalEvidenceBrowserProps<T extends { id: string }> {
  /** Calls the source's search API route (`/api/memories` or
   * `/api/documents`) — never a direct repository call from this client
   * component, and never a client-side filter over an already-downloaded
   * list (RFC-0001 §4/RFC-0003 §10: searching is filtering, and filtering
   * happens in the database). */
  fetchPage: (params: { query: string; offset: number }) => Promise<BrowserPage<T>>;
  /** The server-rendered first page, so the browser has something to show
   * before any client-side fetch ever runs. */
  initialPage: BrowserPage<T>;
  searchPlaceholder: string;
  emptyLabel: string;
  noResultsLabel: string;
  loadMoreLabel: string;
  loadingLabel: string;
  /** One result row. Selection itself (e.g. `setSelectedMemory(item)`) is
   * the caller's concern — this component only renders whatever's given. */
  renderRow: (item: T) => React.ReactNode;
  /** Non-null once the caller has a selection; while set, this component
   * shows `renderPreview(selected)` instead of the search/list — the exact
   * existing preview-and-confirm UI from Sprint-009/011, unchanged. */
  selected: T | null;
  renderPreview: (item: T) => React.ReactNode;
}

/**
 * Sprint-012: the shared list/search/pagination shell for both the Memory
 * and Document Evidence pickers (Sprint-009/011) — not a generic framework
 * for hypothetical future sources, just the one piece of behavior (search
 * with debounce, "Load more", empty states) both concretely need, factored
 * out so it isn't built twice. Source-specific rendering (a Memory's plain
 * content vs. a Document's title/content/excerpt-textarea preview) stays
 * with the caller via `renderRow`/`renderPreview` — this component owns
 * browsing only, never what a result looks like or what happens on
 * confirm (that's still `addEvidenceFromMemory`/`addEvidenceFromDocument`
 * via `EvidenceForm`, completely unchanged).
 *
 * Sprint-013: the search/debounce/pagination/stale-request-guard mechanics
 * themselves now live in the shared `usePaginatedSearch` hook (also used by
 * the standalone Documents library page) — this component just adds the
 * selection/preview layer specific to attaching Evidence. Its own props and
 * behavior are unchanged by that extraction.
 *
 * Searching is filtering, not understanding (RFC-0001 §4, RFC-0003 §10):
 * this component never ranks or judges relevance — it only asks
 * `fetchPage` for a narrower or wider slice and renders whatever comes
 * back, in the order given. Offset-based "Load more", not numbered pages
 * or a cursor (Sprint-012 decision — see `memoryRepository.listMemories`).
 */
export function InternalEvidenceBrowser<T extends { id: string }>({
  fetchPage,
  initialPage,
  searchPlaceholder,
  emptyLabel,
  noResultsLabel,
  loadMoreLabel,
  loadingLabel,
  renderRow,
  selected,
  renderPreview,
}: InternalEvidenceBrowserProps<T>) {
  const { query, onQueryChange, page, isLoading, loadMore, hasQuery } = usePaginatedSearch(fetchPage, initialPage);

  if (selected) return <>{renderPreview(selected)}</>;

  const showEmptyState = page.items.length === 0 && !hasQuery;
  const showNoResults = page.items.length === 0 && hasQuery;

  return (
    <div className="flex flex-col gap-2">
      <input
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={searchPlaceholder}
        className="border-input h-8 rounded-lg border bg-transparent px-2 text-sm"
      />

      {showEmptyState ? (
        <p className="text-muted-foreground text-xs italic">{emptyLabel}</p>
      ) : showNoResults ? (
        <p className="text-muted-foreground text-xs italic">{noResultsLabel}</p>
      ) : (
        <>
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {page.items.map((item) => (
              <li key={item.id}>{renderRow(item)}</li>
            ))}
          </ul>
          {page.hasMore ? (
            <Button type="button" variant="ghost" size="sm" disabled={isLoading} onClick={loadMore}>
              {isLoading ? loadingLabel : loadMoreLabel}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
