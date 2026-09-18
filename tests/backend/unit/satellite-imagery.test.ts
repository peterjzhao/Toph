import { describe, expect, it, vi } from "vitest";
import { MAX_FRAME_PIXELS, renderFrame } from "@/server/satellite/imagery";
import type { FarmExtent } from "@/server/satellite/extent";

const extent: FarmExtent = { minX: -13539500, minY: 4387000, maxX: -13537500, maxY: 4389000, source: "capture" };
const png = () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "Content-Type": "image/png" } });

describe("renderFrame", () => {
  it("renders a single day's pass at Sentinel-2's own resolution", async () => {
    const fetcher = vi.fn(async () => png());
    const frame = await renderFrame(extent, "2026-04-13", "ndvi", "token", fetcher);

    expect(frame.contentType).toBe("image/png");
    expect(frame.bytes.subarray(0, 4)).toEqual(Buffer.from([137, 80, 78, 71]));
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    // 2 km across at 10 m per pixel: asking for more would upsample and cost more.
    expect(body.output).toMatchObject({ width: 200, height: 200 });
    expect(body.input.data[0].dataFilter.timeRange).toEqual({ from: "2026-04-13T00:00:00Z", to: "2026-04-13T23:59:59Z" });
  });

  it("asks for the extent in EPSG:3857, so nothing is reprojected", async () => {
    const fetcher = vi.fn(async () => png());
    await renderFrame(extent, "2026-04-13", "true-colour", "token", fetcher);
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.input.bounds.bbox).toEqual([-13539500, 4387000, -13537500, 4389000]);
    expect(body.input.bounds.properties.crs).toBe("http://www.opengis.net/def/crs/EPSG/0/3857");
  });

  it("caps a large farm at the frame budget", async () => {
    const fetcher = vi.fn(async () => png());
    await renderFrame({ ...extent, maxX: extent.minX + 30_000 }, "2026-04-13", "infrared", "token", fetcher);
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.output.width).toBe(MAX_FRAME_PIXELS);
  });

  it("sends the evalscript matching the requested layer", async () => {
    const fetcher = vi.fn(async () => png());
    await renderFrame(extent, "2026-04-13", "infrared", "token", fetcher);
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    // The false-colour composite puts near infrared in the red channel.
    expect(body.evalscript).toMatch(/B08/);
  });

  it("maps a provider failure to a retryable error", async () => {
    const fetcher = vi.fn(async () => new Response("nope", { status: 500 }));
    await expect(renderFrame(extent, "2026-04-13", "ndvi", "token", fetcher)).rejects.toThrow(/imagery/i);
  });
});
