import { describe, expect, it } from "vitest";
import { dateFilterLabel, dateRange, initialDateFilter, validDateRange } from "../../src/components/dashboard/date-range";

describe("dashboard date ranges", () => {
  it("uses the supplied farm business date for today", () => {
    expect(dateRange({ kind: "today" }, "2026-09-16")).toEqual({ from: "2026-09-16", to: "2026-09-16" });
  });
  it("uses Monday–Sunday weeks across a year boundary", () => {
    expect(dateRange({ kind: "this-week" }, "2027-01-01")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
    expect(dateRange({ kind: "this-week" }, "2027-01-03")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
    expect(dateRange({ kind: "this-week" }, "2027-01-04")).toEqual({ from: "2027-01-04", to: "2027-01-10" });
  });
  it("keeps all seven dates in the spring DST week", () => {
    expect(dateRange({ kind: "this-week" }, "2026-03-08")).toEqual({ from: "2026-03-02", to: "2026-03-08" });
  });
  it("handles leap years, short months, and previous-year month boundaries", () => {
    expect(dateRange({ kind: "this-month" }, "2028-02-20")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(dateRange({ kind: "this-month" }, "2026-02-20")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(dateRange({ kind: "last-month" }, "2026-01-05")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });
  it("includes both boundaries of custom ranges", () => {
    const range = dateRange({ kind: "custom", from: "2026-04-19", to: "2026-04-21" }, "2026-09-16")!;
    const dates = ["2026-04-18", "2026-04-19", "2026-04-20", "2026-04-21", "2026-04-22"];
    expect(dates.filter(date => date >= range.from && date <= range.to)).toEqual(["2026-04-19", "2026-04-20", "2026-04-21"]);
  });
  it("accepts one-day ranges and rejects reversed, missing, and impossible dates", () => {
    expect(validDateRange("2026-04-19", "2026-04-19")).toBe(true);
    expect(validDateRange("2026-04-21", "2026-04-19")).toBe(false);
    expect(validDateRange("", "2026-04-19")).toBe(false);
    expect(validDateRange("2026-02-30", "2026-03-01")).toBe(false);
  });
  it("labels historical data with its actual month rather than This Month", () => {
    const filter = initialDateFilter(["2026-04-19", "2026-03-21", "2026-04-29"], "2026-09-16");
    expect(filter).toEqual({ kind: "month", month: "2026-04" });
    expect(dateFilterLabel(filter)).toBe("April 2026");
    expect(initialDateFilter(["2026-09-01", "2026-04-19"], "2026-09-16")).toEqual({ kind: "this-month" });
    expect(initialDateFilter([], "2026-09-16")).toEqual({ kind: "this-month" });
  });
  it("removes the date restriction for All Time", () => {
    expect(dateRange({ kind: "all" }, "2026-09-16")).toBeNull();
  });
});
