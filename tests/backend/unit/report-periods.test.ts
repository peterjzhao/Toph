import { expect, test } from "vitest";
import { reportKinds, suggestedPeriod } from "@/contracts/reports";

test("each report suggests the period of its own cadence that contains today", () => {
  expect(suggestedPeriod("pesticide-use", "2026-04-29")).toEqual({ from: "2026-04-01", to: "2026-04-30" });
  expect(suggestedPeriod("pesticide-use", "2024-02-10")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  expect(suggestedPeriod("labor-hours", "2026-04-15")).toEqual({ from: "2026-04-01", to: "2026-04-15" });
  expect(suggestedPeriod("labor-hours", "2026-04-16")).toEqual({ from: "2026-04-16", to: "2026-04-30" });
  expect(suggestedPeriod("labor-hours", "2026-02-20")).toEqual({ from: "2026-02-16", to: "2026-02-28" });
  for (const kind of ["food-safety", "harvest-traceability", "organic", "acreage", "nitrogen"] as const) {
    expect(suggestedPeriod(kind, "2026-09-17")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  }
});

test("every suggested period fits one report", () => {
  for (const kind of reportKinds) {
    const { from, to } = suggestedPeriod(kind, "2028-12-31");
    expect(to >= from).toBe(true);
    expect((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1).toBeLessThanOrEqual(400);
  }
});
