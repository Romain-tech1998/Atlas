"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { previewContent } from "@/components/documents/documents-browser";

interface DocumentMatch {
  documentId: string;
  title: string;
  content: string;
  similarity: number;
}

/**
 * Sprint-035 (RFC-0003 §8h): the Document module's "drive intelligent"
 * surface — a question, an explicit "Ask" trigger (never automatic, same
 * cost-gating discipline `research_market_options`'s button established for
 * a paid-per-call Provider), and the matched Documents themselves, reusing
 * `documents-browser.tsx`'s own Card layout and preview convention rather
 * than a second, divergent list UI. An empty `matches` result after a
 * search is rendered as an explicit "nothing relevant found" message, not
 * silence — the same honesty `research_market_options`'s zero-result case
 * already established in this UI.
 */
export function DocumentSemanticSearch() {
  const t = useTranslations("documents");
  const [question, setQuestion] = useState("");
  const [matches, setMatches] = useState<DocumentMatch[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAsk() {
    if (isSearching || question.trim().length === 0) return;
    setIsSearching(true);
    setError(null);
    try {
      const response = await fetch("/api/documents/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim() }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const code = body?.error;
        const message =
          code === "unauthorized" ? t("semanticSearch.unauthorized") : t("semanticSearch.unavailable");
        throw new Error(message);
      }
      setMatches(body?.matches ?? []);
    } catch (askError) {
      setMatches(null);
      setError(askError instanceof Error ? askError.message : t("semanticSearch.unavailable"));
    } finally {
      setIsSearching(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div>
        <h2 className="text-sm font-medium">{t("semanticSearch.title")}</h2>
        <p className="text-muted-foreground text-xs">{t("semanticSearch.hint")}</p>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={t("semanticSearch.placeholder")}
          className="border-input h-9 flex-1 rounded-lg border bg-transparent px-3 text-sm"
        />
        <Button type="button" size="sm" disabled={isSearching || question.trim().length === 0} onClick={handleAsk}>
          {isSearching ? t("semanticSearch.searching") : t("semanticSearch.ask")}
        </Button>
      </div>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      {matches !== null && matches.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("semanticSearch.noMatches")}</p>
      ) : null}

      {matches && matches.length > 0 ? (
        <div className="flex flex-col gap-3">
          {matches.map((match) => (
            <Link key={match.documentId} href={`/documents/${match.documentId}`} className="block">
              <Card className="hover:bg-muted/40 transition-colors">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{match.title}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <p className="text-sm whitespace-pre-wrap">{previewContent(match.content)}</p>
                  <p className="text-muted-foreground text-xs">
                    {t("semanticSearch.similarity", { value: Math.round(match.similarity * 100) })}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
