import { describe, expect, it } from "vitest";
import { responseAccuracy } from "@/contracts/response-accuracy";

describe("responseAccuracy", () => {
  it("rounds the approved share of decided logs to the nearest 5", () => {
    expect(responseAccuracy(10, 1)).toBe(90);
    expect(responseAccuracy(11, 0)).toBe(100);
    expect(responseAccuracy(7, 1)).toBe(90);
    expect(responseAccuracy(2, 1)).toBe(65);
    expect(responseAccuracy(0, 3)).toBe(0);
  });

  it("has no score until a log has been approved or flagged", () => {
    expect(responseAccuracy(0, 0)).toBeNull();
  });
});
