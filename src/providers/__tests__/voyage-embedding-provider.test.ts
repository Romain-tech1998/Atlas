import { describe, it, expect } from "vitest";
import { mapVoyageResponse } from "@/providers/voyage-embedding-provider";

describe("mapVoyageResponse", () => {
  it("maps a well-formed response to the embedding vector", () => {
    const result = mapVoyageResponse({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
    });

    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  it("throws when `data` is missing entirely", () => {
    expect(() => mapVoyageResponse({})).toThrow();
  });

  it("throws when `data` is an empty array", () => {
    expect(() => mapVoyageResponse({ data: [] })).toThrow();
  });

  it("throws when the first entry has no `embedding` field", () => {
    expect(() => mapVoyageResponse({ data: [{}] })).toThrow();
  });

  it("throws when `embedding` is an empty array", () => {
    expect(() => mapVoyageResponse({ data: [{ embedding: [] }] })).toThrow();
  });
});
