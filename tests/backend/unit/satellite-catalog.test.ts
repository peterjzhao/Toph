import { describe, expect, it, vi } from "vitest";
import { MAX_CLOUD_COVER, monthlySpine, searchAcquisitions, type Acquisition } from "@/server/satellite/catalog";
import type { FarmExtent } from "@/server/satellite/extent";

const extent: FarmExtent = { minX: -13539500, minY: 4387000, maxX: -13537500, maxY: 4389000, source: "capture" };

const feature = (datetime: string, cloud: number) => ({ type: "Feature", properties: { datetime, "eo:cloud_cover": cloud } });
const page = (features: unknown[], next?: number | string) => Response.json({ type: "FeatureCollection", features, context: next === undefined ? {} : { next } });

const acquisitions = (...pairs: [string, number][]): Acquisition[] => pairs.map(([date, cloudCover]) => ({ date, cloudCover }));

describe("monthlySpine", () => {
  it("keeps one stop per month, choosing that month's clearest pass", () => {
    const spine = monthlySpine(acquisitions(["2026-04-03", 22], ["2026-04-13", 4], ["2026-04-23", 15]));
    expect(spine).toEqual([{ month: "2026-04", date: "2026-04-13", cloudCover: 4, acquisitions: 3 }]);
  });

  it("drops passes too cloudy to show anything", () => {
    expect(monthlySpine(acquisitions(["2026-04-03", MAX_CLOUD_COVER + 1]))).toEqual([]);
    expect(monthlySpine(acquisitions(["2026-04-03", MAX_CLOUD_COVER]))).toHaveLength(1);
  });

  it("counts only the usable passes in each month", () => {
    const spine = monthlySpine(acquisitions(["2026-04-03", 5], ["2026-04-13", 90], ["2026-04-23", 9]));
    expect(spine[0].acquisitions).toBe(2);
  });

  it("orders stops oldest first across years", () => {
    const spine = monthlySpine(acquisitions(["2026-04-03", 5], ["2017-06-01", 5], ["2026-03-02", 5]));
    expect(spine.map(stop => stop.month)).toEqual(["2017-06", "2026-03", "2026-04"]);
  });

  it("returns nothing for an archive with no clear pass", () => {
    expect(monthlySpine([])).toEqual([]);
  });
});

describe("searchAcquisitions", () => {
  it("searches the catalogue in WGS84 over the farm's own bbox", async () => {
    const fetcher = vi.fn(async () => page([feature("2026-04-13T18:50:21Z", 4.2)]));
    const result = await searchAcquisitions(extent, { from: "2017-01-01", to: "2026-09-17" }, "token", fetcher);

    expect(result).toEqual([{ date: "2026-04-13", cloudCover: 4.2 }]);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/catalog.*search$/);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token");
    // application/json is answered with 406 Not Acceptable; the catalogue serves GeoJSON.
    expect((init.headers as Record<string, string>).Accept).toBe("application/geo+json");
    const body = JSON.parse(init.body as string);
    expect(body.collections).toEqual(["sentinel-2-l2a"]);
    expect(body.datetime).toBe("2017-01-01T00:00:00Z/2026-09-17T23:59:59Z");
    // Longitude/latitude, not the metres the Statistical API takes.
    expect(body.bbox[0]).toBeCloseTo(-121.627398, 4);
    expect(body.bbox[3]).toBeCloseTo(36.639672, 4);
  });

  it("follows the catalogue's paging until the archive is exhausted", async () => {
    // The live catalogue sends `next` as a string ("5"), not a number.
    const fetcher = vi.fn()
      .mockResolvedValueOnce(page([feature("2026-04-03T18:50:21Z", 10)], "1"))
      .mockResolvedValueOnce(page([feature("2026-04-13T18:50:21Z", 4)]));
    const result = await searchAcquisitions(extent, { from: "2026-04-01", to: "2026-04-30" }, "token", fetcher);

    expect(result.map(item => item.date)).toEqual(["2026-04-03", "2026-04-13"]);
    expect(JSON.parse((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body as string).next).toBe("1");
  });

  it("stops paging rather than following a catalogue that never ends", async () => {
    const fetcher = vi.fn(async () => page([feature("2026-04-03T18:50:21Z", 10)], "1"));
    await searchAcquisitions(extent, { from: "2017-01-01", to: "2026-09-17" }, "token", fetcher);
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(20);
  });

  it("asks the catalogue to drop cloudy scenes, and drops any it lets through", async () => {
    const fetcher = vi.fn(async () => page([feature("2026-04-03T18:50:21Z", MAX_CLOUD_COVER + 5), feature("2026-04-13T18:50:21Z", 4)]));
    const result = await searchAcquisitions(extent, { from: "2026-04-01", to: "2026-04-30" }, "token", fetcher, MAX_CLOUD_COVER);

    expect(result).toEqual([{ date: "2026-04-13", cloudCover: 4 }]);
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    // CQL2 text, verified against the live catalogue on September 17, 2026.
    expect(body.filter).toBe(`eo:cloud_cover <= ${MAX_CLOUD_COVER}`);
    expect(body["filter-lang"]).toBe("cql2-text");
  });

  it("sends no filter when every pass is wanted", async () => {
    const fetcher = vi.fn(async () => page([feature("2026-04-03T18:50:21Z", 90)]));
    const result = await searchAcquisitions(extent, { from: "2026-04-01", to: "2026-04-30" }, "token", fetcher);

    expect(result).toEqual([{ date: "2026-04-03", cloudCover: 90 }]);
    expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).filter).toBeUndefined();
  });

  it("treats a pass with no reported cloud cover as fully clouded rather than perfect", async () => {
    const fetcher = vi.fn(async () => page([{ type: "Feature", properties: { datetime: "2026-04-13T18:50:21Z" } }]));
    const result = await searchAcquisitions(extent, { from: "2026-04-01", to: "2026-04-30" }, "token", fetcher);
    expect(result).toEqual([{ date: "2026-04-13", cloudCover: 100 }]);
  });

  it("maps a provider failure to a retryable error", async () => {
    const fetcher = vi.fn(async () => new Response("nope", { status: 500 }));
    await expect(searchAcquisitions(extent, { from: "2026-04-01", to: "2026-04-30" }, "token", fetcher)).rejects.toThrow(/imagery/i);
  });
});
