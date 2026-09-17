import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fieldMapHref, fieldMapImage, fieldMapRegion, fieldMapRegions } from "../../src/lib/field-map";

// Independent interior samples from visual review, in fractions of the full image.
const samples = [[.52,.48],[.645,.32],[.645,.48],[.57,.62],[.50,.82],[.645,.17],[.39,.84],[.04,.80],[.22,.82],[.63,.82],[.86,.30]];
function contains(polygon: number[][], [x,y]: number[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi,yi] = polygon[i], [xj,yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

describe("field map assets and image segmentation", () => {
  it("maps eleven distinct regions to existing images and stable field IDs", () => {
    expect(fieldMapRegions.map(region => region.key).join("")).toBe("ABCDEFGHIJK");
    expect(new Set(fieldMapRegions.map(region => region.fieldId)).size).toBe(11);
    for (const region of fieldMapRegions) {
      expect(existsSync(`public${region.imageUrl}`)).toBe(true);
      expect(region.polygon.length).toBeGreaterThanOrEqual(3);
      for (const point of region.polygon) for (const coordinate of point) {
        expect(coordinate).toBeGreaterThanOrEqual(0);
        expect(coordinate).toBeLessThanOrEqual(1);
      }
    }
  });
  it("selects exactly the intended field at each independently chosen interior point", () => {
    samples.forEach((point,index) => {
      expect(fieldMapRegions.filter(region => contains(region.polygon, point)).map(region => region.key)).toEqual([String.fromCharCode(65 + index)]);
    });
  });
  it("does not assign the lake, forest, or road to a field", () => {
    for (const point of [[.4,.3],[.15,.2],[.5,.684]]) {
      expect(fieldMapRegions.some(region => contains(region.polygon, point))).toBe(false);
    }
  });
  it("uses a field's generated asset without applying sample regions to custom imagery", () => {
    const field = fieldMapRegions[1];
    expect(fieldMapImage(field.fieldId, "/assets/field-map.svg")).toBe(field.imageUrl);
    expect(fieldMapImage(field.fieldId, "/custom-map.png")).toBe("/custom-map.png");
    expect(fieldMapImage("unknown", "/custom-map.png")).toBe("/custom-map.png");
    expect(fieldMapRegion("unknown")).toBeUndefined();
    expect(fieldMapImage("unknown", null)).toBe("");
    expect(fieldMapHref(field.fieldId)).toBe(`/map?field=${field.fieldId}`);
  });
});
