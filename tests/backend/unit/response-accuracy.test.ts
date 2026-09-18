import { describe, expect, it } from "vitest";
import { responseAccuracy } from "@/contracts/response-accuracy";

describe("responseAccuracy", () => {
  it("rounds the approved share of decided logs to the nearest 10", () => {
    expect(responseAccuracy(6, 1)).toBe(90); // 85.7%: the Bays Ranch demo's seven reviewed logs
    expect(responseAccuracy(10, 1)).toBe(90); // 90.9%
    expect(responseAccuracy(2, 1)).toBe(70); // 66.7%
    expect(responseAccuracy(11, 0)).toBe(100);
    expect(responseAccuracy(0, 3)).toBe(0);
  });

  it("rounds an exact half up", () => {
    expect(responseAccuracy(17, 3)).toBe(90); // 85%
    expect(responseAccuracy(1, 3)).toBe(30); // 25%
    expect(responseAccuracy(19, 1)).toBe(100); // 95%
  });

  it("has no score until a log has been approved or flagged", () => {
    expect(responseAccuracy(0, 0)).toBeNull();
  });
});
