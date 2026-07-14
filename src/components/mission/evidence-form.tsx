"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import Link from "next/link";
import { NORMALIZED_MEASURES } from "@/domain/evidence-normalization";
import { InternalEvidenceBrowser, type BrowserPage } from "./internal-evidence-browser";
import type { AttachableMemory, AttachableDocument, InternalEvidencePage } from "@/services/evidenceService";
import type { CalendarEventForEvidence, CalendarEventsResponse } from "@/app/api/calendar/events/route";

interface EvidenceFormProps {
  decisionId: string;
  /** Sprint-034: the Decision's own title, already resolved to a plain
   * string server-side — the `subject` sent to `research_market_options`. */
  decisionSubject: string;
  /** Sprint-034: the criteria to score researched options against —
   * whatever measures this Decision's Evidence already implies, or a
   * small fixed default when there's none yet (`decision-evidence.tsx`'s
   * `deriveResearchCriteria`). */
  researchCriteria: string[];
  /** Sprint-009 Path C, Sprint-012 browsing: the first page of the user's
   * own Memory entries — the shared browser fetches further pages itself
   * via `/api/memories` as the user searches or clicks "Load more". */
  initialMemories: InternalEvidencePage<AttachableMemory>;
  /** Sprint-011 Path D, Sprint-012 browsing: same convention as
   * `initialMemories`, via `/api/documents`. */
  initialDocuments: InternalEvidencePage<AttachableDocument>;
}

async function fetchJsonPage<T>(url: string, query: string, offset: number): Promise<BrowserPage<T>> {
  const params = new URLSearchParams();
  if (query.trim().length > 0) params.set("query", query.trim());
  params.set("offset", String(offset));

  const response = await fetch(`${url}?${params.toString()}`);
  if (!response.ok) return { items: [], hasMore: false };
  return response.json();
}

/**
 * Sprint-008: the default free-text Claim/Source/Add row is unchanged from
 * Sprint-004. Structured input (Value/Currency/Measure/Observed date) lives
 * in a collapsed-by-default panel beneath it — natural language stays the
 * primary interaction, structured fields are an optional precision upgrade
 * a user can ignore entirely. Only fields the user actually filled in are
 * sent; the server (`evidenceService.validateStructuredInput`) is the real
 * gate, this component's job is just not to send obviously-wrong shapes.
 *
 * Sprint-009 adds a third, also collapsed-by-default option: picking one of
 * the user's own Memory entries. Selecting one never attaches it
 * immediately — it shows a preview of the exact claim text that will be
 * recorded, and only an explicit confirm click submits it (never a silent
 * one-click attach).
 *
 * Sprint-011 adds a fourth: picking one of the user's own Documents, then
 * typing/pasting the exact excerpt to attach — the full Document content is
 * shown so the user can read and copy from it, but nothing is auto-selected
 * and no "likely fact" is highlighted (RFC-0001 §4: the user's own judgment
 * replaces any relevance heuristic). Same explicit-preview-then-confirm
 * discipline as Path C.
 *
 * Sprint-012 replaces both pickers' plain lists with the shared
 * `InternalEvidenceBrowser` (search + debounce + "Load more"), so browsing
 * Memories and Documents feels identical — but the preview/confirm UI
 * below (`renderPreview`) is the exact same JSX Sprint-009/011 already
 * built, just relocated into a render function; nothing about
 * confirmation, validation, or persistence changed.
 */
export function EvidenceForm({
  decisionId,
  decisionSubject,
  researchCriteria,
  initialMemories,
  initialDocuments,
}: EvidenceFormProps) {
  const router = useRouter();
  const t = useTranslations("decision.evidence");
  const tCommon = useTranslations("common");
  const tNav = useTranslations("nav");
  const [claim, setClaim] = useState("");
  const [source, setSource] = useState("");
  const [showStructured, setShowStructured] = useState(false);
  const [optionLabel, setOptionLabel] = useState("");
  const [measure, setMeasure] = useState("");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState("");
  const [observedAt, setObservedAt] = useState("");
  const [isResearching, setIsResearching] = useState(false);
  const [showMemoryPicker, setShowMemoryPicker] = useState(false);
  const [selectedMemory, setSelectedMemory] = useState<AttachableMemory | null>(null);
  const [showDocumentPicker, setShowDocumentPicker] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<AttachableDocument | null>(null);
  const [excerptDraft, setExcerptDraft] = useState("");
  const [showCalendarPicker, setShowCalendarPicker] = useState(false);
  const [calendarStatus, setCalendarStatus] = useState<CalendarEventsResponse["status"] | "idle" | "loading">("idle");
  const [calendarPage, setCalendarPage] = useState<InternalEvidencePage<CalendarEventForEvidence> | null>(null);
  const [selectedCalendarEvent, setSelectedCalendarEvent] = useState<CalendarEventForEvidence | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setClaim("");
    setSource("");
    setOptionLabel("");
    setMeasure("");
    setValue("");
    setCurrency("");
    setObservedAt("");
  }

  /** Shared POST + error-handling for every creation path (free text,
   * structured, Memory, Document) — only the request body differs between
   * callers. Unchanged since Sprint-009/011. */
  async function postEvidence(body: Record<string, unknown>): Promise<boolean> {
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/decisions/${decisionId}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const responseBody = await response.json().catch(() => null);
        throw new Error(responseBody?.error ?? t("addFailed"));
      }
      router.refresh();
      return true;
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : tCommon("somethingWentWrong"));
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!claim.trim() || !source.trim() || isSubmitting) return;

    const body: Record<string, unknown> = { claim: claim.trim(), source: source.trim() };
    if (value.trim().length > 0) body.value = Number(value);
    if (currency.trim().length > 0) body.currency = currency.trim();
    if (measure.length > 0) body.measure = measure;
    if (observedAt.length > 0) body.observedAt = observedAt;
    if (optionLabel.trim().length > 0) body.optionLabel = optionLabel.trim();

    if (await postEvidence(body)) resetForm();
  }

  /** Sprint-034 (RFC-0003 §8g): the explicit, cost-gated trigger for
   * `research_market_options` — an AI API call costs real money per
   * invocation, so this only ever runs from this one deliberate button
   * press, never automatically on page load or alongside any other
   * submission. `addedOptions === 0` is a genuinely different outcome
   * from a network/auth failure: it means the search ran but found
   * nothing groundable, and is reported to the user as exactly that,
   * not as an error. */
  async function handleResearch() {
    if (isResearching) return;
    setIsResearching(true);
    setError(null);
    try {
      const response = await fetch(`/api/decisions/${decisionId}/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: decisionSubject, criteria: researchCriteria }),
      });
      const responseBody = await response.json().catch(() => null);
      if (!response.ok) {
        const code = responseBody?.error;
        const message =
          code === "unauthorized"
            ? t("research.unauthorized")
            : code === "unavailable"
              ? t("research.unavailable")
              : t("addFailed");
        throw new Error(message);
      }
      if (responseBody?.addedOptions === 0) {
        setError(t("research.noneFound"));
      } else {
        router.refresh();
      }
    } catch (researchError) {
      setError(researchError instanceof Error ? researchError.message : tCommon("somethingWentWrong"));
    } finally {
      setIsResearching(false);
    }
  }

  async function handleAttachMemory() {
    if (!selectedMemory || isSubmitting) return;
    if (await postEvidence({ memoryId: selectedMemory.id })) setSelectedMemory(null);
  }

  async function handleAttachDocument() {
    if (!selectedDocument || isSubmitting || excerptDraft.trim().length === 0) return;
    if (await postEvidence({ documentId: selectedDocument.id, excerpt: excerptDraft })) {
      setSelectedDocument(null);
      setExcerptDraft("");
    }
  }

  /** Decision 4 (Sprint-016): fetched lazily on first open, not
   * server-prefetched like Memory/Document — a calendar fetch is a real
   * external API call (and can trigger a Google token refresh), so it only
   * ever runs when the user actually opens this toggle. */
  async function fetchCalendarEvents(query: string): Promise<CalendarEventsResponse> {
    const params = new URLSearchParams();
    if (query.trim().length > 0) params.set("query", query.trim());
    const response = await fetch(`/api/calendar/events?${params.toString()}`);
    if (!response.ok) return { status: "unavailable" };
    return response.json();
  }

  async function toggleCalendarPicker() {
    const opening = !showCalendarPicker;
    setShowCalendarPicker(opening);
    if (opening && calendarStatus === "idle") {
      setCalendarStatus("loading");
      const result = await fetchCalendarEvents("");
      setCalendarStatus(result.status);
      if (result.status === "connected") setCalendarPage({ items: result.items, hasMore: result.hasMore });
    }
  }

  async function fetchCalendarPage({ query }: { query: string; offset: number }): Promise<BrowserPage<CalendarEventForEvidence>> {
    const result = await fetchCalendarEvents(query);
    if (result.status !== "connected") return { items: [], hasMore: false };
    return { items: result.items, hasMore: result.hasMore };
  }

  async function handleAttachCalendarEvent() {
    if (!selectedCalendarEvent || isSubmitting) return;
    if (await postEvidence({ calendarEventId: selectedCalendarEvent.id })) setSelectedCalendarEvent(null);
  }

  /** Client-side display only — computed the same deterministic way the
   * server does (`YYYY-MM-DD` slice, never locale-formatted, and the same
   * fixed non-i18n'd `"Untitled event"` literal for a falsy title — this
   * previews stored data, not UI copy). The server independently
   * recomputes this on attach from a fresh re-fetch (decision 1/3), so a
   * client-side mismatch here is never trusted. */
  function calendarEventClaimPreview(event: CalendarEventForEvidence): string {
    const title = event.title || "Untitled event";
    return `${title} — ${event.start.slice(0, 10)}`;
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="evidence-claim" className="text-muted-foreground text-xs font-normal">
            {t("claimLabel")}
          </Label>
          <Input
            id="evidence-claim"
            value={claim}
            onChange={(event) => setClaim(event.target.value)}
            placeholder={t("claimPlaceholder")}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="evidence-source" className="text-muted-foreground text-xs font-normal">
            {t("sourceLabel")}
          </Label>
          <Input
            id="evidence-source"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder={t("sourcePlaceholder")}
            disabled={isSubmitting}
          />
        </div>
        <Button type="submit" disabled={isSubmitting || !claim.trim() || !source.trim()} className="sm:self-end">
          {isSubmitting ? t("adding") : t("add")}
        </Button>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={showStructured}
        onClick={() => setShowStructured((prev) => !prev)}
        className="text-muted-foreground self-start"
      >
        {t("structured.toggle")}
      </Button>

      {showStructured ? (
        <div className="grid grid-cols-2 gap-2 rounded-lg border p-3 sm:grid-cols-5">
          <div className="flex flex-col gap-1">
            <Label htmlFor="evidence-option-label" className="text-muted-foreground text-xs font-normal">
              {t("structured.optionLabelLabel")}
            </Label>
            <Input
              id="evidence-option-label"
              value={optionLabel}
              onChange={(event) => setOptionLabel(event.target.value)}
              placeholder={t("structured.optionLabelPlaceholder")}
              disabled={isSubmitting}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="evidence-measure" className="text-muted-foreground text-xs font-normal">
              {t("structured.measureLabel")}
            </Label>
            <select
              id="evidence-measure"
              value={measure}
              onChange={(event) => setMeasure(event.target.value)}
              disabled={isSubmitting}
              className="border-input h-8 rounded-lg border bg-transparent px-2 text-sm"
            >
              <option value="">{t("structured.measureBlank")}</option>
              {NORMALIZED_MEASURES.map((option) => (
                <option key={option} value={option}>
                  {t(`measure.${option}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="evidence-value" className="text-muted-foreground text-xs font-normal">
              {t("structured.valueLabel")}
            </Label>
            <Input
              id="evidence-value"
              type="number"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={isSubmitting}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="evidence-currency" className="text-muted-foreground text-xs font-normal">
              {t("structured.currencyLabel")}
            </Label>
            <Input
              id="evidence-currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
              placeholder={t("structured.currencyPlaceholder")}
              disabled={isSubmitting}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="evidence-observed-at" className="text-muted-foreground text-xs font-normal">
              {t("structured.observedAtLabel")}
            </Label>
            <Input
              id="evidence-observed-at"
              type="date"
              value={observedAt}
              onChange={(event) => setObservedAt(event.target.value)}
              disabled={isSubmitting}
            />
          </div>
          <div className="col-span-2 flex flex-col gap-1 sm:col-span-5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isResearching}
              onClick={handleResearch}
              className="self-start"
            >
              {isResearching ? t("research.searching") : t("research.trigger")}
            </Button>
            <p className="text-muted-foreground text-xs">{t("research.hint")}</p>
          </div>
        </div>
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={showMemoryPicker}
        onClick={() => setShowMemoryPicker((prev) => !prev)}
        className="text-muted-foreground self-start"
      >
        {t("fromMemory.toggle")}
      </Button>

      {showMemoryPicker ? (
        <div className="rounded-lg border p-3">
          <InternalEvidenceBrowser<AttachableMemory>
            initialPage={initialMemories}
            fetchPage={({ query, offset }) => fetchJsonPage<AttachableMemory>("/api/memories", query, offset)}
            searchPlaceholder={t("browser.searchPlaceholder")}
            emptyLabel={t("fromMemory.empty")}
            noResultsLabel={t("browser.noResults")}
            loadMoreLabel={t("browser.loadMore")}
            loadingLabel={t("browser.loading")}
            selected={selectedMemory}
            renderRow={(memory) => (
              <button
                type="button"
                onClick={() => setSelectedMemory(memory)}
                className="hover:bg-muted w-full rounded-md px-2 py-1 text-left text-sm"
              >
                {memory.content}
              </button>
            )}
            renderPreview={(memory) => (
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground text-xs font-normal">{t("fromMemory.previewLabel")}</p>
                <p className="text-sm">{memory.content}</p>
                <div className="flex gap-2">
                  <Button type="button" size="sm" disabled={isSubmitting} onClick={handleAttachMemory}>
                    {isSubmitting ? t("adding") : t("fromMemory.confirm")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isSubmitting}
                    onClick={() => setSelectedMemory(null)}
                  >
                    {t("fromMemory.cancel")}
                  </Button>
                </div>
              </div>
            )}
          />
        </div>
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={showDocumentPicker}
        onClick={() => setShowDocumentPicker((prev) => !prev)}
        className="text-muted-foreground self-start"
      >
        {t("fromDocument.toggle")}
      </Button>

      {showDocumentPicker ? (
        <div className="rounded-lg border p-3">
          <InternalEvidenceBrowser<AttachableDocument>
            initialPage={initialDocuments}
            fetchPage={({ query, offset }) => fetchJsonPage<AttachableDocument>("/api/documents", query, offset)}
            searchPlaceholder={t("browser.searchPlaceholder")}
            emptyLabel={t("fromDocument.empty")}
            noResultsLabel={t("browser.noResults")}
            loadMoreLabel={t("browser.loadMore")}
            loadingLabel={t("browser.loading")}
            selected={selectedDocument}
            renderRow={(document) => (
              <button
                type="button"
                onClick={() => setSelectedDocument(document)}
                className="hover:bg-muted w-full rounded-md px-2 py-1 text-left text-sm"
              >
                {document.title}
              </button>
            )}
            renderPreview={(document) => (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">{document.title}</p>
                <div className="bg-muted/30 max-h-40 overflow-y-auto rounded-md p-2 text-sm whitespace-pre-wrap">
                  {document.content}
                </div>
                <Label htmlFor="evidence-excerpt" className="text-muted-foreground text-xs font-normal">
                  {t("fromDocument.excerptLabel")}
                </Label>
                <Textarea
                  id="evidence-excerpt"
                  value={excerptDraft}
                  onChange={(event) => setExcerptDraft(event.target.value)}
                  placeholder={t("fromDocument.excerptPlaceholder")}
                  disabled={isSubmitting}
                  className="min-h-16 text-sm"
                />
                {excerptDraft.trim().length > 0 ? (
                  <div className="flex flex-col gap-1">
                    <p className="text-muted-foreground text-xs font-normal">{t("fromDocument.previewLabel")}</p>
                    <p className="text-sm">{excerptDraft.trim()}</p>
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={isSubmitting || excerptDraft.trim().length === 0}
                    onClick={handleAttachDocument}
                  >
                    {isSubmitting ? t("adding") : t("fromDocument.confirm")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isSubmitting}
                    onClick={() => {
                      setSelectedDocument(null);
                      setExcerptDraft("");
                    }}
                  >
                    {t("fromDocument.cancel")}
                  </Button>
                </div>
              </div>
            )}
          />
        </div>
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={showCalendarPicker}
        onClick={toggleCalendarPicker}
        className="text-muted-foreground self-start"
      >
        {t("fromCalendar.toggle")}
      </Button>

      {showCalendarPicker ? (
        <div className="rounded-lg border p-3">
          {calendarStatus === "loading" ? (
            <p className="text-muted-foreground text-xs italic">{t("browser.loading")}</p>
          ) : calendarStatus === "reconnect_required" ? (
            <div className="flex flex-col gap-1">
              <p className="text-muted-foreground text-xs">{t("fromCalendar.reconnectRequired")}</p>
              <Link href="/providers" className="text-foreground self-start text-xs underline">
                {tNav("providers")} →
              </Link>
            </div>
          ) : calendarStatus === "unavailable" ? (
            <p className="text-muted-foreground text-xs">{t("fromCalendar.unavailable")}</p>
          ) : calendarStatus === "connected" && calendarPage ? (
            <InternalEvidenceBrowser<CalendarEventForEvidence>
              initialPage={calendarPage}
              fetchPage={fetchCalendarPage}
              searchPlaceholder={t("browser.searchPlaceholder")}
              emptyLabel={t("fromCalendar.empty")}
              noResultsLabel={t("browser.noResults")}
              loadMoreLabel={t("browser.loadMore")}
              loadingLabel={t("browser.loading")}
              selected={selectedCalendarEvent}
              renderRow={(event) => (
                <button
                  type="button"
                  onClick={() => setSelectedCalendarEvent(event)}
                  className="hover:bg-muted w-full rounded-md px-2 py-1 text-left text-sm"
                >
                  {event.title || "Untitled event"}{" "}
                  <span className="text-muted-foreground text-xs">{event.start.slice(0, 10)}</span>
                </button>
              )}
              renderPreview={(event) => (
                <div className="flex flex-col gap-2">
                  <p className="text-muted-foreground text-xs font-normal">{t("fromCalendar.previewLabel")}</p>
                  <p className="text-sm">{calendarEventClaimPreview(event)}</p>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" disabled={isSubmitting} onClick={handleAttachCalendarEvent}>
                      {isSubmitting ? t("adding") : t("fromCalendar.confirm")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isSubmitting}
                      onClick={() => setSelectedCalendarEvent(null)}
                    >
                      {t("fromCalendar.cancel")}
                    </Button>
                  </div>
                </div>
              )}
            />
          ) : null}
        </div>
      ) : null}

      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </form>
  );
}
