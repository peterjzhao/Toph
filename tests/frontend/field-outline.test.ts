import { describe, expect, it } from "vitest";
import { fieldMarker, fieldPresentation, roundedFieldPath, signedFieldDistance, simplifyFieldOutline } from "../../src/lib/field-outline";

describe("reviewed field presentation", () => {
  it("removes pixel stairs from a rectangular field and rounds its four corners", () => {
    const boundary = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 101, y: 1 }, { x: 101, y: 59 }, { x: 100, y: 59 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
    const before = structuredClone(boundary);
    const simple = simplifyFieldOutline(boundary);
    expect(simple).toEqual([{ x: 0, y: 0 }, { x: 101, y: 0 }, { x: 101, y: 60 }, { x: 0, y: 60 }]);
    const path = roundedFieldPath(simple);
    expect(path.match(/A/g)).toHaveLength(4);
    expect(path).not.toMatch(/NaN|Infinity/);
    expect(boundary).toEqual(before);
  });

  it("preserves a concave cutout and places the marker inside the field", () => {
    const u = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 70, y: 100 }, { x: 70, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 100 }, { x: 0, y: 100 }];
    const simple = simplifyFieldOutline(u);
    expect(simple).toHaveLength(8);
    expect(signedFieldDistance({ x: 50, y: 60 }, simple)).toBeLessThan(0);
    const marker = fieldMarker(simple, 1000);
    expect(marker.radius).toBeGreaterThan(0);
    expect(signedFieldDistance(marker, simple)).toBeGreaterThan(marker.radius);
    expect(roundedFieldPath(simple)).toContain("0 0 0");
  });

  it("keeps image aspect ratio in its geometry and supports reversed rings", () => {
    const rectangle = [{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .9, y: .9 }, { x: .1, y: .9 }];
    const shape = fieldPresentation(rectangle, 1000, 500);
    expect(shape.marker.x).toBe(500);
    expect(shape.marker.y).toBe(250);
    expect(shape.path).toBe(fieldPresentation([...rectangle].reverse(), 1000, 500).path);
    expect(shape.points).toEqual([{ x: 100, y: 50 }, { x: 900, y: 50 }, { x: 900, y: 450 }, { x: 100, y: 450 }]);
  });

  it("retains a narrow triangular parcel without unstable arcs", () => {
    const triangle = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1, y: 4 }];
    expect(simplifyFieldOutline(triangle)).toHaveLength(3);
    expect(roundedFieldPath(triangle)).not.toMatch(/NaN|Infinity/);
    const marker = fieldMarker(triangle, 1000);
    expect(signedFieldDistance(marker, triangle)).toBeGreaterThan(marker.radius);
  });
});
