import { describe, it, expect } from "vitest";
import { mapOpenMeteoResponse, mapGeocodingResponse } from "@/providers/open-meteo-provider";

describe("mapOpenMeteoResponse", () => {
  it("maps a well-formed response to the matching WeatherSnapshot", () => {
    const result = mapOpenMeteoResponse({
      current: {
        temperature_2m: 21.4,
        wind_speed_10m: 12.8,
        weather_code: 3,
        time: "2026-07-12T14:00",
      },
    });

    expect(result).toEqual({
      temperatureC: 21.4,
      windSpeedKmh: 12.8,
      weatherCode: 3,
      observedAt: "2026-07-12T14:00",
    });
  });

  it("throws when `current` is missing entirely", () => {
    expect(() => mapOpenMeteoResponse({})).toThrow();
  });

  it("throws when `current` is present but missing weather_code", () => {
    expect(() =>
      mapOpenMeteoResponse({
        current: {
          temperature_2m: 21.4,
          wind_speed_10m: 12.8,
          time: "2026-07-12T14:00",
        },
      }),
    ).toThrow();
  });

  it("throws when `current` is present but missing temperature_2m", () => {
    expect(() =>
      mapOpenMeteoResponse({
        current: {
          wind_speed_10m: 12.8,
          weather_code: 3,
          time: "2026-07-12T14:00",
        },
      }),
    ).toThrow();
  });

  it("throws when `current` is present but missing time", () => {
    expect(() =>
      mapOpenMeteoResponse({
        current: {
          temperature_2m: 21.4,
          wind_speed_10m: 12.8,
          weather_code: 3,
        },
      }),
    ).toThrow();
  });
});

describe("mapGeocodingResponse", () => {
  it("maps a well-formed single-result response correctly", () => {
    const result = mapGeocodingResponse({
      results: [{ name: "Montreal", latitude: 45.5017, longitude: -73.5673, admin1: "Quebec", country: "Canada" }],
    });

    expect(result).toEqual({
      latitude: 45.5017,
      longitude: -73.5673,
      resolvedName: "Montreal, Quebec, Canada",
    });
  });

  it("joins resolvedName correctly when admin1/country are missing", () => {
    const result = mapGeocodingResponse({
      results: [{ name: "Somewhereville", latitude: 1.23, longitude: 4.56 }],
    });

    expect(result).toEqual({
      latitude: 1.23,
      longitude: 4.56,
      resolvedName: "Somewhereville",
    });
  });

  it("maps a missing `results` array to null", () => {
    expect(mapGeocodingResponse({})).toBeNull();
  });

  it("maps an empty `results` array to null", () => {
    expect(mapGeocodingResponse({ results: [] })).toBeNull();
  });
});
