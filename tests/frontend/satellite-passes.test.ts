import { describe, expect, it } from "vitest";
import { passIndexForDate, type SatellitePass } from "../../src/lib/satellite-passes";

const passes: SatellitePass[] = ["2026-08-02", "2026-08-07", "2026-08-12", "2026-08-22"].map(date => ({ date, cloudCover: 5 }));
const today = "2026-09-17";

describe("passIndexForDate", () => {
  it("lands on a pass taken that day", () => {
    expect(passIndexForDate(passes, "2026-08-07", today)).toBe(1);
  });

  it("lands on the nearest pass between two", () => {
    expect(passIndexForDate(passes, "2026-08-08", today)).toBe(1);
    expect(passIndexForDate(passes, "2026-08-11", today)).toBe(2);
  });

  it("prefers the earlier pass when two are equally near", () => {
    expect(passIndexForDate(passes, "2026-08-17", today)).toBe(2);
  });

  it("clamps to the first pass before the archive starts", () => {
    expect(passIndexForDate(passes, "2015-01-01", today)).toBe(0);
  });

  it("uses the latest pass for a recent day that had none", () => {
    expect(passIndexForDate(passes, "2026-09-16", today)).toBe(3);
  });

  it("shows the saved map for today, later dates, an empty picker and no passes", () => {
    expect(passIndexForDate(passes, today, today)).toBe(passes.length);
    expect(passIndexForDate(passes, "2026-12-01", today)).toBe(passes.length);
    expect(passIndexForDate(passes, "", today)).toBe(passes.length);
    expect(passIndexForDate([], "2026-08-07", today)).toBe(0);
  });
});
