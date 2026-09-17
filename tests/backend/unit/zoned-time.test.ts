import { describe, expect, it } from "vitest";
import { instantToLocalDate, localDateTimeToInstant } from "@/server/time/zoned";

describe("zoned time helpers", () => {
  it("converts a farm-local wall time to a UTC instant during daylight saving time", () => {
    expect(localDateTimeToInstant("2026-04-19", "06:00", "America/Los_Angeles").toISOString()).toBe(
      "2026-04-19T13:00:00.000Z",
    );
    expect(localDateTimeToInstant("2026-04-19", "10:40", "America/Los_Angeles").toISOString()).toBe(
      "2026-04-19T17:40:00.000Z",
    );
  });

  it("converts a farm-local wall time to a UTC instant during standard time", () => {
    expect(localDateTimeToInstant("2026-01-15", "06:00", "America/Los_Angeles").toISOString()).toBe(
      "2026-01-15T14:00:00.000Z",
    );
  });

  it("returns the business date of an instant in the farm timezone", () => {
    expect(instantToLocalDate(new Date("2026-04-19T13:00:00Z"), "America/Los_Angeles")).toBe("2026-04-19");
    // 06:59 UTC on April 20 is still 23:59 on April 19 in Los Angeles.
    expect(instantToLocalDate(new Date("2026-04-20T06:59:00Z"), "America/Los_Angeles")).toBe("2026-04-19");
  });

  it("rejects invalid dates, times, and time zones", () => {
    expect(() => localDateTimeToInstant("2026-02-30", "06:00", "America/Los_Angeles")).toThrow();
    expect(() => localDateTimeToInstant("2026-04-19", "24:00", "America/Los_Angeles")).toThrow();
    expect(() => localDateTimeToInstant("2026-04-19", "06:00", "Mars/Olympus")).toThrow();
  });
});
