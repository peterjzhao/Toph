import { describe, expect, it } from "vitest";
import { boundaryBbox, bboxToLngLat, fieldGeometry, frameSize, parseFarmExtent, polygonAreaMercator, type FarmExtent } from "@/server/satellite/extent";

/** A 2 km square near Salinas, California, in EPSG:3857 metres. */
const extent: FarmExtent = { minX: -13539500, minY: 4387000, maxX: -13537500, maxY: 4389000, source: "capture" };

describe("parseFarmExtent", () => {
  it("accepts a stored extent and keeps its source", () => {
    expect(parseFarmExtent({ minX: -13539500, minY: 4387000, maxX: -13537500, maxY: 4389000, source: "located" })).toEqual({
      minX: -13539500, minY: 4387000, maxX: -13537500, maxY: 4389000, source: "located",
    });
  });

  it("rejects inverted, tiny, oversized and out-of-world extents", () => {
    expect(() => parseFarmExtent({ ...extent, maxX: -13539600 })).toThrow(/extent/i);
    expect(() => parseFarmExtent({ ...extent, maxX: extent.minX + 50 })).toThrow(/extent/i);
    expect(() => parseFarmExtent({ ...extent, maxX: extent.minX + 90_000 })).toThrow(/extent/i);
    expect(() => parseFarmExtent({ ...extent, minX: -99_999_999 })).toThrow(/extent/i);
  });

  it("rejects an unknown source and a partial extent", () => {
    expect(() => parseFarmExtent({ ...extent, source: "guessed" })).toThrow(/extent/i);
    expect(() => parseFarmExtent({ minX: extent.minX, maxX: extent.maxX, source: "capture" })).toThrow(/extent/i);
    expect(() => parseFarmExtent(null)).toThrow(/extent/i);
  });
});

describe("fieldGeometry", () => {
  it("maps a normalized boundary into Web Mercator with the image y-axis flipped", () => {
    // The image origin is top-left, so y = 0 is the extent's NORTH edge.
    const geometry = fieldGeometry([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], extent);
    expect(geometry.coordinates[0].slice(0, 3)).toEqual([
      [-13539500, 4389000],
      [-13537500, 4389000],
      [-13537500, 4387000],
    ]);
  });

  it("closes the ring and declares EPSG:3857 so no reprojection is needed", () => {
    const geometry = fieldGeometry([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], extent);
    const ring = geometry.coordinates[0];
    expect(ring).toHaveLength(4);
    expect(ring.at(-1)).toEqual(ring[0]);
    expect(geometry.crs).toEqual({ type: "name", properties: { name: "http://www.opengis.net/def/crs/EPSG/0/3857" } });
  });

  it("refuses a boundary that is not a polygon", () => {
    expect(() => fieldGeometry([{ x: 0, y: 0 }, { x: 1, y: 1 }], extent)).toThrow(/boundary/i);
  });
});

describe("boundaryBbox", () => {
  it("frames one field rather than the whole farm", () => {
    expect(boundaryBbox([{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.25 }, { x: 0.75, y: 0.5 }], extent))
      .toEqual([-13539000, 4388000, -13538000, 4388500]);
  });
});

describe("polygonAreaMercator", () => {
  it("measures a field in the same units the statistics request uses", () => {
    // The whole 2 km square extent.
    expect(polygonAreaMercator([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], extent)).toBe(4_000_000);
    expect(polygonAreaMercator([{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 0.5 }], extent)).toBe(1_000_000);
  });

  it("does not depend on the winding direction of the saved ring", () => {
    const clockwise = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }];
    expect(polygonAreaMercator(clockwise, extent)).toBe(polygonAreaMercator([...clockwise].reverse(), extent));
  });
});

describe("bboxToLngLat", () => {
  it("converts the extent to WGS84, which is what a STAC catalogue search expects", () => {
    const [west, south, east, north] = bboxToLngLat(extent);
    expect(west).toBeCloseTo(-121.627398, 5);
    expect(south).toBeCloseTo(36.625254, 5);
    expect(east).toBeCloseTo(-121.609432, 5);
    expect(north).toBeCloseTo(36.639672, 5);
  });

  it("puts the null island at the origin", () => {
    expect(bboxToLngLat({ ...extent, minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 }).map(Math.round)).toEqual([-0, -0, 0, 0]);
  });
});

describe("frameSize", () => {
  it("sizes to Sentinel-2's 10 m resolution instead of upsampling", () => {
    // 2000 m across at 10 m per pixel is 200 px. Asking for more invents detail and costs more.
    expect(frameSize(extent, 1024)).toEqual({ width: 200, height: 200 });
  });

  it("caps a large farm at the requested pixel budget, keeping its aspect ratio", () => {
    const wide: FarmExtent = { ...extent, maxX: extent.minX + 20_000, maxY: extent.minY + 10_000 };
    expect(frameSize(wide, 1024)).toEqual({ width: 1024, height: 512 });
  });

  it("keeps a narrow extent above a usable floor", () => {
    const sliver: FarmExtent = { ...extent, maxY: extent.minY + 100 };
    expect(frameSize(sliver, 1024).height).toBeGreaterThanOrEqual(16);
  });
});
