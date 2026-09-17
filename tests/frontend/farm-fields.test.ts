import { describe, expect, it } from "vitest";
import { FIELD_LABELS, nextFieldLabel, validFieldBoundary } from "../../src/lib/farm-fields";

const square = [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
describe("farm field setup", () => {
  it("accepts real boundaries and rejects empty, collinear, out-of-image and nonfinite points", () => {
    expect(validFieldBoundary(square)).toBe(true);
    expect(validFieldBoundary([])).toBe(false);
    expect(validFieldBoundary([{x:0,y:0},{x:.5,y:.5},{x:1,y:1}])).toBe(false);
    expect(validFieldBoundary([...square, {x:1.01,y:.5}])).toBe(false);
    expect(validFieldBoundary([...square, {x:NaN,y:.5}])).toBe(false);
  });
  it("reuses an available field letter without duplicating an existing name and stops at Z", () => {
    const fields = FIELD_LABELS.map(label => ({ label, boundary:square }));
    expect(nextFieldLabel(fields)).toBeUndefined();
    expect(nextFieldLabel(fields.filter(field => field.label !== "M"))).toBe("M");
    expect(nextFieldLabel([])).toBe("A");
  });
});
