import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { EvidenceForm } from "./evidence-form";
import { renderLocalized } from "@/i18n/render";
import { normalizeEvidence, type NormalizedValue } from "@/domain/evidence-normalization";
import type { EvidenceItem, VerdictSummary } from "@/domain/decision";
import type { AttachableMemory, AttachableDocument, InternalEvidencePage } from "@/services/evidenceService";

interface DecisionEvidenceProps {
  decisionId: string;
  /** Sprint-034: the Decision's own title, already resolved to a plain
   * string server-side (`renderLocalized`) — the `subject` sent to
   * `research_market_options` when the user presses "Research real
   * options" in `EvidenceForm`. */
  decisionTitle: string;
  evidence: EvidenceItem[];
  verdict: VerdictSummary;
  /** Sprint-009: the user's own Memory entries, offered as a third,
   * explicit Evidence creation path (Path C) alongside free text and
   * structured input — see `EvidenceForm`. Sprint-012: only the first page
   * is server-rendered; the browser fetches more itself via `/api/memories`
   * as the user searches/scrolls. */
  initialMemories: InternalEvidencePage<AttachableMemory>;
  /** Sprint-011: the user's own Documents, offered as a fourth explicit
   * Evidence creation path (Path D) — an excerpt the user selects
   * themselves, never the whole Document — see `EvidenceForm`. Sprint-012:
   * same first-page-only convention as `initialMemories`, via
   * `/api/documents`. */
  initialDocuments: InternalEvidencePage<AttachableDocument>;
}

/**
 * Structured normalized values only — the `user_provided` catch-all is
 * intentionally not surfaced here: it's identical to `claim`, already shown
 * above it, so rendering it too would just repeat the same text back at the
 * user (RFC-0001 §4's traceability is satisfied either way, by construction,
 * whether or not this UI shows it).
 *
 * `measure` (Sprint-007) is appended lightly ("899 CAD · price") only when
 * recognized — an absent/unknown measure shows no suffix at all rather than
 * an "unknown" badge, per RFC-0001 §4: absence already communicates it.
 */
type EvidenceTranslator = (key: string, values?: Record<string, string | number>) => string;

function formatNormalizedValue(t: EvidenceTranslator, value: NormalizedValue): string | null {
  switch (value.kind) {
    case "currency":
      return value.measure
        ? t("normalized.currencyWithMeasure", {
            amount: value.value,
            currency: value.currency,
            measure: t(`measure.${value.measure}`),
          })
        : t("normalized.currency", { amount: value.value, currency: value.currency });
    case "numeric":
      return value.measure
        ? t("normalized.numericWithMeasure", { amount: value.value, measure: t(`measure.${value.measure}`) })
        : t("normalized.numeric", { amount: value.value });
    case "date":
      return t("normalized.date", { date: value.value });
    case "user_provided":
      return null;
  }
}

/** Sprint-011: `metadata.sourceDocumentTitle` is read only to build a
 * translated "From document: <title>" label — never rendered as raw
 * metadata, and the Document's content is never shown here again (only the
 * excerpt already recorded as `claim`, right above). */
function getSourceDocumentTitle(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const title = (metadata as Record<string, unknown>).sourceDocumentTitle;
  return typeof title === "string" ? title : null;
}

/** Sprint-016 (Path E): same pattern as `getSourceDocumentTitle` —
 * `metadata.calendarEventTitle` is read only to build a translated "From
 * calendar: <title>" label, never rendered as raw metadata. */
function getSourceCalendarTitle(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const title = (metadata as Record<string, unknown>).calendarEventTitle;
  return typeof title === "string" ? title : null;
}

/** Sprint-030/031: `metadata.optionLabel` names which Shopping option this
 * Evidence describes — same read-only, never-guessed pattern as
 * `getSourceDocumentTitle`/`getSourceCalendarTitle`. Shown as its own badge,
 * not folded into the source line, since an item can independently have
 * both an option label and a source document/calendar title. */
function getOptionLabel(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const label = (metadata as Record<string, unknown>).optionLabel;
  return typeof label === "string" ? label : null;
}

/** Whatever recognized measures this Decision's Evidence already uses —
 * the criteria `research_market_options` is asked to score options
 * against, so a fresh research call stays consistent with what's already
 * been entered by hand. `Decision` deliberately has no `module` field
 * (RFC-0003 §7a/§8h), so there's no honest module-aware default to fall
 * back on when nothing's known yet — an empty array tells the Provider to
 * pick its own relevant criteria instead of guessing one here
 * (Sprint-036, RFC-0003 §8g/§8h follow-up). */
function deriveResearchCriteria(evidence: EvidenceItem[]): string[] {
  const measures = new Set<string>();
  for (const item of evidence) {
    for (const value of normalizeEvidence(item)) {
      if ((value.kind === "numeric" || value.kind === "currency") && value.measure) {
        measures.add(value.measure);
      }
    }
  }
  return [...measures]; // empty array when nothing is known yet — no hardcoded guess
}

/** One Evidence item's claim/source and its normalized-value badges. Shared
 * by the full Evidence list and (Sprint-006) the "Why?" section's filtered
 * list, so the two never drift into two different presentations of the
 * same Evidence. */
function EvidenceRow({ item, t }: { item: EvidenceItem; t: EvidenceTranslator }) {
  const normalizedLabels = normalizeEvidence(item)
    .map((value) => formatNormalizedValue(t, value))
    .filter((label): label is string => label !== null);
  const sourceDocumentTitle = getSourceDocumentTitle(item.metadata);
  const sourceCalendarTitle = getSourceCalendarTitle(item.metadata);
  const optionLabel = getOptionLabel(item.metadata);

  return (
    <li className="rounded-lg border px-3 py-2 text-sm">
      <p>{item.claim}</p>
      <p className="text-muted-foreground text-xs">
        {sourceDocumentTitle
          ? t("sourceDocument", { title: sourceDocumentTitle })
          : sourceCalendarTitle
            ? t("sourceCalendar", { title: sourceCalendarTitle })
            : item.source}
      </p>
      {optionLabel || normalizedLabels.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {optionLabel ? (
            <Badge variant="outline" className="text-xs font-normal">
              {t("optionLabelBadge", { optionLabel })}
            </Badge>
          ) : null}
          {normalizedLabels.map((label) => (
            <Badge key={label} variant="secondary" className="text-xs font-normal">
              {label}
            </Badge>
          ))}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Sprint-004 introduced this section always showing the honest "needs more
 * information" message, since nothing could produce a real recommendation
 * yet. Sprint-006 (`find_lowest_value`, RFC-0003 §8a/§9) is the first time
 * `verdict.status` can actually be `PRODUCED` — when it is, this also shows
 * the recommendation and a "Why?" list of exactly the Evidence
 * `find_lowest_value` compared (`verdict.comparedEvidenceIds`), reusing the
 * same normalized-value badges as the main list. No percentages, no
 * confidence score — the cited Evidence is the only trust mechanism
 * (RFC-0001 §4/§5's "no fake confidence" rule).
 */
export async function DecisionEvidence({
  decisionId,
  decisionTitle,
  evidence,
  verdict,
  initialMemories,
  initialDocuments,
}: DecisionEvidenceProps) {
  const t = await getTranslations("decision.evidence");
  const tRoot = await getTranslations();
  const researchCriteria = deriveResearchCriteria(evidence);

  const comparedEvidenceIds = verdict.comparedEvidenceIds;
  const comparedEvidence = comparedEvidenceIds
    ? evidence.filter((item) => comparedEvidenceIds.includes(item.id))
    : [];

  return (
    <section className="flex flex-col gap-3 rounded-2xl border p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{t("title")}</h2>
        <Badge variant="outline">{t("count", { count: evidence.length })}</Badge>
      </div>

      <p className="text-muted-foreground text-sm">
        {verdict.status === "INSUFFICIENT_EVIDENCE" ? t("insufficientEvidence") : t("produced")}
      </p>

      {evidence.length === 0 ? (
        <p className="text-muted-foreground text-xs italic">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {evidence.map((item) => (
            <EvidenceRow key={item.id} item={item} t={t} />
          ))}
        </ul>
      )}

      {verdict.status === "PRODUCED" && verdict.recommendation ? (
        <div className="rounded-lg border p-3">
          <p className="text-sm font-medium">{renderLocalized(tRoot, verdict.recommendation)}</p>
          {verdict.ranking && verdict.ranking.length > 0 ? (
            <div className="mt-3 flex flex-col gap-1">
              <p className="text-foreground/80 text-xs font-medium">{t("ranking.title")}</p>
              <ol className="flex flex-col gap-1">
                {verdict.ranking.map((entry, index) => (
                  <li key={entry.optionLabel} className="flex items-center justify-between text-sm">
                    <span>{t("ranking.position", { position: index + 1, optionLabel: entry.optionLabel })}</span>
                    <span className="text-muted-foreground text-xs">
                      {t("ranking.score", { score: entry.score.toFixed(2) })}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          {comparedEvidence.length > 0 ? (
            <div className="mt-3 flex flex-col gap-2">
              <p className="text-foreground/80 text-xs font-medium">{t("why.title")}</p>
              <ul className="flex flex-col gap-2">
                {comparedEvidence.map((item) => (
                  <EvidenceRow key={item.id} item={item} t={t} />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <EvidenceForm
        decisionId={decisionId}
        decisionSubject={decisionTitle}
        researchCriteria={researchCriteria}
        initialMemories={initialMemories}
        initialDocuments={initialDocuments}
      />
    </section>
  );
}
