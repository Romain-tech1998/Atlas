"use client";

import { useEffect, useRef, useState } from "react";

const SEARCH_DEBOUNCE_MS = 300;

export interface SearchPage<T> {
  items: T[];
  hasMore: boolean;
}

export interface UsePaginatedSearchResult<T> {
  query: string;
  /** Updates the query immediately (so the input reflects every keystroke)
   * and schedules a debounced search — never fires a request per keystroke. */
  onQueryChange: (nextQuery: string) => void;
  page: SearchPage<T>;
  isLoading: boolean;
  loadMore: () => void;
  /** Whether `query` (trimmed) is non-empty — callers use this to tell an
   * empty-library state ("nothing exists at all") apart from a no-results
   * state ("this search matched nothing"), since both look like `page.items
   * .length === 0` from the outside. */
  hasQuery: boolean;
}

/**
 * Sprint-013: the shared debounce + offset-pagination + stale-request-guard
 * primitive behind both `InternalEvidenceBrowser` (Sprint-012, the Evidence
 * pickers) and the standalone Documents library page — extracted so this
 * logic exists exactly once in the codebase rather than twice. Deliberately
 * headless: no rendering, and no concept of "selection"/"preview" — those
 * are specific to the Evidence picker's select → preview → confirm-attach
 * flow and have no equivalent for a library page where a result just opens
 * a detail view. Not a speculative framework — built for these two concrete
 * uses, nothing more.
 *
 * Searching is filtering, not understanding (RFC-0001 §4, RFC-0003 §10):
 * this hook never ranks or judges relevance — it only asks `fetchPage` for
 * a narrower or wider slice and stores whatever comes back, in the order
 * given. Changing the query resets to offset 0 and replaces the result set;
 * `loadMore` appends at the current `offset` without duplicating rows.
 */
export function usePaginatedSearch<T>(
  fetchPage: (params: { query: string; offset: number }) => Promise<SearchPage<T>>,
  initialPage: SearchPage<T>,
): UsePaginatedSearchResult<T> {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(initialPage);
  const [isLoading, setIsLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against an in-flight search's response arriving after a newer
  // one — the older result must never clobber a fresher search's results.
  const requestIdRef = useRef(0);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function runSearch(nextQuery: string) {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    fetchPage({ query: nextQuery, offset: 0 })
      .then((result) => {
        if (requestId !== requestIdRef.current) return;
        setPage(result);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setIsLoading(false);
      });
  }

  function onQueryChange(nextQuery: string) {
    setQuery(nextQuery);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(nextQuery), SEARCH_DEBOUNCE_MS);
  }

  async function loadMore() {
    setIsLoading(true);
    try {
      const next = await fetchPage({ query, offset: page.items.length });
      setPage((prev) => ({ items: [...prev.items, ...next.items], hasMore: next.hasMore }));
    } finally {
      setIsLoading(false);
    }
  }

  return { query, onQueryChange, page, isLoading, loadMore, hasQuery: query.trim().length > 0 };
}
