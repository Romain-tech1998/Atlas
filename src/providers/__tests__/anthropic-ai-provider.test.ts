import { describe, it, expect } from "vitest";
import { mapMarketOptionsResponse } from "@/providers/anthropic-ai-provider";

describe("mapMarketOptionsResponse", () => {
  it("maps a well-formed response to MarketOption[]", () => {
    const result = mapMarketOptionsResponse({
      options: [
        {
          optionLabel: "Air France AF123",
          values: [
            { measure: "price", value: 450, currency: "CAD", source: "https://example.com/af123" },
            { measure: "duration", value: 7, source: "https://example.com/af123" },
          ],
        },
        {
          optionLabel: "Lufthansa LH456",
          values: [{ measure: "price", value: 380, currency: "CAD", source: "https://example.com/lh456" }],
        },
      ],
    });

    expect(result).toEqual([
      {
        optionLabel: "Air France AF123",
        values: [
          { measure: "price", value: 450, currency: "CAD", source: "https://example.com/af123" },
          { measure: "duration", value: 7, source: "https://example.com/af123" },
        ],
      },
      {
        optionLabel: "Lufthansa LH456",
        values: [{ measure: "price", value: 380, currency: "CAD", source: "https://example.com/lh456" }],
      },
    ]);
  });

  it("returns an empty array when the model honestly found nothing groundable", () => {
    expect(mapMarketOptionsResponse({ options: [] })).toEqual([]);
  });

  it("drops a value missing a required field (measure) rather than fabricating one", () => {
    const result = mapMarketOptionsResponse({
      options: [
        {
          optionLabel: "Option A",
          values: [
            { value: 10, source: "https://example.com" },
            { measure: "price", value: 20, source: "https://example.com" },
          ],
        },
      ],
    });

    expect(result).toEqual([{ optionLabel: "Option A", values: [{ measure: "price", value: 20, source: "https://example.com" }] }]);
  });

  it("drops a value missing a required field (source) rather than fabricating one", () => {
    const result = mapMarketOptionsResponse({
      options: [
        {
          optionLabel: "Option A",
          values: [
            { measure: "price", value: 10 },
            { measure: "price", value: 20, source: "https://example.com" },
          ],
        },
      ],
    });

    expect(result).toEqual([{ optionLabel: "Option A", values: [{ measure: "price", value: 20, source: "https://example.com" }] }]);
  });

  it("drops a value whose value is not a finite number", () => {
    const result = mapMarketOptionsResponse({
      options: [
        {
          optionLabel: "Option A",
          values: [
            { measure: "price", value: "not a number", source: "https://example.com" },
            { measure: "price", value: 20, source: "https://example.com" },
          ],
        },
      ],
    });

    expect(result).toEqual([{ optionLabel: "Option A", values: [{ measure: "price", value: 20, source: "https://example.com" }] }]);
  });

  it("drops an entire option when every one of its values is malformed", () => {
    const result = mapMarketOptionsResponse({
      options: [
        { optionLabel: "Fully malformed option", values: [{ value: 10 }] },
        {
          optionLabel: "Valid option",
          values: [{ measure: "price", value: 20, source: "https://example.com" }],
        },
      ],
    });

    expect(result).toEqual([
      { optionLabel: "Valid option", values: [{ measure: "price", value: 20, source: "https://example.com" }] },
    ]);
  });

  it("drops an option missing optionLabel", () => {
    const result = mapMarketOptionsResponse({
      options: [{ values: [{ measure: "price", value: 20, source: "https://example.com" }] }],
    });

    expect(result).toEqual([]);
  });

  it("returns an empty array when the top-level shape has no options array", () => {
    expect(mapMarketOptionsResponse({})).toEqual([]);
  });

  it("returns an empty array when given a non-object", () => {
    expect(mapMarketOptionsResponse(null)).toEqual([]);
    expect(mapMarketOptionsResponse("not an object")).toEqual([]);
    expect(mapMarketOptionsResponse(42)).toEqual([]);
  });
});
