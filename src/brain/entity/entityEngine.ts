import type { IntentResult } from "@/brain/intent/types";
import type { EntityResult } from "./types";

const DATE_KEYWORDS = [
  "today",
  "tomorrow",
  "tonight",
  "next week",
  "next monday",
  "next tuesday",
  "next wednesday",
  "next thursday",
  "next friday",
  "next saturday",
  "next sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "for",
  "of",
  "and",
  "or",
  "is",
  "are",
  "i",
  "me",
  "my",
  "that",
]);

function extractKeywords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
    ),
  ).slice(0, 8);
}

function extractDueDate(text: string): string | undefined {
  const lower = text.toLowerCase();
  return DATE_KEYWORDS.find((keyword) => lower.includes(keyword));
}

function extractTitle(rawInput: string, triggerMatch: string | null): string {
  if (!triggerMatch) return rawInput.trim();
  const stripped = rawInput.slice(triggerMatch.length).trim();
  return stripped || rawInput.trim();
}

/**
 * Deterministic entity extractor: pulls a title, an optional due date, and
 * a handful of keywords out of the raw input, using the Intent Engine's
 * matched trigger phrase (if any) to isolate the subject of the request.
 */
export function extractEntities(rawInput: string, intent: IntentResult): EntityResult {
  return {
    title: extractTitle(rawInput, intent.triggerMatch),
    dueDate: extractDueDate(rawInput),
    keywords: extractKeywords(rawInput),
  };
}

export const entityEngine = { extractEntities };
