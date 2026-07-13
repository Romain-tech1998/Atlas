import type { AxisIntentId, AxisModuleId } from "@/domain/axis";
import type { IntentResult } from "./types";

interface IntentRule {
  module: AxisModuleId;
  intent: AxisIntentId;
  /** Patterns tested against the input; first match wins. */
  patterns: RegExp[];
  confidence: number;
}

const RULES: IntentRule[] = [
  {
    module: "task",
    intent: "create_task",
    confidence: 0.9,
    patterns: [
      /^remind me to\s+/i,
      /^remember to\s+/i,
      /^i need to\s+/i,
      /^add (a )?task\s*[:\-]?\s*/i,
      /^todo\s*[:\-]?\s*/i,
      /^schedule\s+/i,
    ],
  },
  {
    module: "memory",
    intent: "store_memory",
    confidence: 0.85,
    patterns: [
      /^remember that\s+/i,
      /^note that\s+/i,
      /^i like\s+/i,
      /^i am\s+/i,
      /^my favorite\s+/i,
      /^my favourite\s+/i,
    ],
  },
  {
    module: "document",
    intent: "create_document",
    confidence: 0.85,
    patterns: [
      /^write down\s+/i,
      /^save this note\s*[:\-]?\s*/i,
      /^draft\s+/i,
      /^document\s*[:\-]?\s*/i,
    ],
  },
  {
    module: "travel",
    intent: "compare_travel_options",
    confidence: 0.85,
    patterns: [
      /^compare\s+(flights?|hotels?|trips?)\b/i,
      /^help me (plan|choose|book)\s+(a\s+)?trip\b/i,
      /^(flights?|hotels?)\s+(to|for)\s+/i,
      /^book\s+(a\s+)?(flight|hotel|trip)\b/i,
    ],
  },
  {
    module: "shopping",
    intent: "compare_shopping_options",
    confidence: 0.85,
    patterns: [
      /^compare\s+/i,
      /^help me choose (between|among)\s+/i,
      /^which (one )?should i (buy|choose|pick|get)\b/i,
      /^shop(ping)? for\s+/i,
    ],
  },
  {
    module: "conversation",
    intent: "ask_question",
    confidence: 0.75,
    patterns: [/^(what|how|why|when|who|where|can you|could you)\b/i],
  },
];

/**
 * Deterministic, rule-based stand-in for a real intent classifier. Matches
 * the input against a fixed set of trigger phrases to decide what the user
 * wants and which module should own it.
 */
export function detectIntent(rawInput: string): IntentResult {
  for (const rule of RULES) {
    const matchedPattern = rule.patterns.find((pattern) => pattern.test(rawInput));
    if (!matchedPattern) continue;

    const [triggerMatch] = rawInput.match(matchedPattern) ?? [];
    return {
      intent: rule.intent,
      module: rule.module,
      confidence: rule.confidence,
      triggerMatch: triggerMatch ?? null,
    };
  }

  return {
    intent: "unknown",
    module: "unknown",
    confidence: 0.3,
    triggerMatch: null,
  };
}

export const intentEngine = { detectIntent };
