import { describe, expect, it, vi } from "vitest";
import type { FieldPoint } from "@/contracts/accounts";
import type { FarmExtent } from "@/server/satellite/extent";
import { MIN_VALID_FRACTION, STATISTICS_RESOLUTION_METRES, fetchFieldStatistics, readStatistics } from "@/server/satellite/statistics";

const extent: FarmExtent = { minX: -13539500, minY: 4387000, maxX: -13537500, maxY: 4389000, source: "capture" };
/** The whole 2 km square: 4,000,000 m², which is 40,000 pixels at 10 m. */
const boundary: FieldPoint[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
const EXPECTED_PIXELS = 4_000_000 / STATISTICS_RESOLUTION_METRES ** 2;

type IntervalOptions = { valid?: number; mean?: number; error?: string };
const interval = (from: string, { valid = EXPECTED_PIXELS, mean = 0.62, error }: IntervalOptions = {}) => error
  ? { interval: { from: `${from}T00:00:00Z` }, error }
  : {
    interval: { from: `${from}T00:00:00Z` },
    outputs: { ndvi: { bands: { B0: { stats: { min: 0.1, max: 0.9, mean, stDev: 0.08, sampleCount: 60_000, noDataCount: 60_000 - valid } } } } },
  };

const body = (...intervals: unknown[]) => Response.json({ status: "OK", data: intervals });

describe("readStatistics", () => {
  it("keeps an observation when enough of the field was cloud-free", () => {
    const observations = readStatistics(body_data(interval("2026-04-13", { valid: EXPECTED_PIXELS })), 4_000_000);
    expect(observations).toEqual([{ date: "2026-04-13", mean: 0.62, min: 0.1, max: 0.9, stDev: 0.08, validFraction: 1 }]);
  });

  it("drops an observation when cloud hid too much of the field", () => {
    const half = EXPECTED_PIXELS * (MIN_VALID_FRACTION - 0.1);
    expect(readStatistics(body_data(interval("2026-04-13", { valid: half })), 4_000_000)).toEqual([]);
  });

  it("keeps an observation sitting exactly on the threshold", () => {
    const edge = EXPECTED_PIXELS * MIN_VALID_FRACTION;
    expect(readStatistics(body_data(interval("2026-04-13", { valid: edge })), 4_000_000)).toHaveLength(1);
  });

  it("skips intervals the provider reported an error for", () => {
    expect(readStatistics(body_data(interval("2026-04-13", { error: "BAD_REQUEST" })), 4_000_000)).toEqual([]);
  });

  it("orders observations oldest first", () => {
    const observations = readStatistics(body_data(interval("2026-05-13"), interval("2026-04-13"), interval("2026-04-03")), 4_000_000);
    expect(observations.map(item => item.date)).toEqual(["2026-04-03", "2026-04-13", "2026-05-13"]);
  });

  it("never reports more than a whole field as clear, despite resampling", () => {
    const observations = readStatistics(body_data(interval("2026-04-13", { valid: EXPECTED_PIXELS * 1.3 })), 4_000_000);
    expect(observations[0].validFraction).toBe(1);
  });

  it("drops a fully masked interval, which the provider reports with a string NaN mean", () => {
    // Observed live: a cloud covering the whole field returns
    // { min: "NaN", max: "NaN", mean: "NaN", sampleCount: 704, noDataCount: 704 }.
    const masked = [{
      interval: { from: "2025-12-16T00:00:00Z" },
      outputs: { ndvi: { bands: { B0: { stats: { min: "NaN", max: "NaN", mean: "NaN", stDev: "NaN", sampleCount: 704, noDataCount: 704 } } } } },
    }];
    expect(readStatistics(masked, 4_000_000)).toEqual([]);
  });

  it("ignores an interval with no usable statistics block", () => {
    expect(readStatistics([{ interval: { from: "2026-04-13T00:00:00Z" }, outputs: {} }], 4_000_000)).toEqual([]);
  });
});

describe("fetchFieldStatistics", () => {
  it("asks for the field's own polygon in EPSG:3857, so nothing is reprojected", async () => {
    const fetcher = vi.fn(async () => body(interval("2026-04-13")));
    const result = await fetchFieldStatistics(boundary, extent, { from: "2026-04-01", to: "2026-04-30" }, "token", fetcher);

    expect(result.map(item => item.date)).toEqual(["2026-04-13"]);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/statistics$/);
    const sent = JSON.parse(init.body as string);
    expect(sent.input.bounds.geometry.type).toBe("Polygon");
    expect(sent.input.bounds.properties.crs).toBe("http://www.opengis.net/def/crs/EPSG/0/3857");
    expect(sent.aggregation.resx).toBe(STATISTICS_RESOLUTION_METRES);
    expect(sent.aggregation.aggregationInterval).toEqual({ of: "P1D" });
    // The cloud test has to be in the evalscript, or the mean is measuring weather.
    expect(sent.aggregation.evalscript).toMatch(/SCL/);
  });

  it("maps a provider failure to a retryable error", async () => {
    const fetcher = vi.fn(async () => new Response("nope", { status: 500 }));
    await expect(fetchFieldStatistics(boundary, extent, { from: "2026-04-01", to: "2026-04-30" }, "token", fetcher)).rejects.toThrow(/imagery/i);
  });
});

/** The `data` array as `readStatistics` receives it, without re-wrapping in a Response. */
function body_data(...intervals: unknown[]) {
  return intervals;
}
