import { describe, expect, it } from "vitest";
import { geocodeFarmLocation, parseImageryBbox } from "@/server/accounts/farm-imagery";

describe("parseImageryBbox", () => {
  it("sizes the export to the view's aspect ratio with a 1600px long side", () => {
    expect(parseImageryBbox("-13539500,4387000,-13537500,4388250")).toEqual({ bbox: [-13539500, 4387000, -13537500, 4388250], width: 1600, height: 1000 });
  });

  it("rejects missing, malformed, and out-of-world views", () => {
    for (const value of [null, "", "1,2,3", "a,b,c,d", "-99999999,0,1000,1000"]) expect(() => parseImageryBbox(value)).toThrow(/map view/);
  });

  it("rejects views that are too small, too large, or inverted", () => {
    expect(() => parseImageryBbox("0,0,50,50")).toThrow(/Zoom out/);
    expect(() => parseImageryBbox("1000,1000,0,0")).toThrow(/Zoom out/);
    expect(() => parseImageryBbox("0,0,90000,90000")).toThrow(/Zoom in/);
  });
});

describe("geocodeFarmLocation", () => {
  it("reads pasted coordinates without calling the geocoder", async () => {
    await expect(geocodeFarmLocation("36.62, -121.62")).resolves.toEqual({ lat: 36.62, lng: -121.62, label: "36.62, -121.62" });
  });

  it("rejects empty input and out-of-range coordinates", async () => {
    await expect(geocodeFarmLocation(" ")).rejects.toThrow(/address or coordinates/);
    await expect(geocodeFarmLocation("95, -121")).rejects.toThrow(/out of range/);
  });
});
