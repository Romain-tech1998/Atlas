import type { Provider } from "@/providers/provider";

/**
 * RFC-0003 §8g (Sprint-034): the narrow capability interface an AI-backed
 * Provider satisfies — mirrors `WeatherProvider`'s shape exactly. Only
 * `information:retrieve` this sprint; `embedding:generate` is reserved for
 * the Document module's own future sprint on the same Provider instance,
 * not built here.
 */
export interface MarketOptionValue {
  measure: string;
  value: number;
  currency?: string;
  /** A short, human-readable citation of where this value came from
   * (e.g. a URL or publication name) — required, never invented if the
   * model can't ground a claim in an actual source. */
  source: string;
}

export interface MarketOption {
  optionLabel: string;
  values: MarketOptionValue[];
}

export interface AIProvider extends Provider {
  /** Asks the model to find real, named, currently-true options for
   * `subject`, each scored against `criteria` (a list of recognized
   * `NormalizedMeasure` strings, e.g. ["price", "rating"]). Returns an
   * empty array — never a guess — if nothing groundable was found. */
  researchMarketOptions(subject: string, criteria: string[]): Promise<MarketOption[]>;
}
