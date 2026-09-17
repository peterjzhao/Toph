import { describe, expect, it } from "vitest";
import { normalizeTagLabel } from "@/server/validation/tag-label";

describe("normalizeTagLabel", () => {
  it("trims, collapses internal whitespace, and keeps readable casing", () => {
    expect(normalizeTagLabel("  Needs   review ")).toEqual({ label: "Needs review", normalizedLabel: "needs review" });
  });

  it("derives a lowercase uniqueness key", () => {
    expect(normalizeTagLabel("URGENT").normalizedLabel).toBe("urgent");
    expect(normalizeTagLabel("Urgent").normalizedLabel).toBe(normalizeTagLabel("uRGENT").normalizedLabel);
  });

  it("applies Unicode NFC so composed and decomposed forms match", () => {
    const composed = normalizeTagLabel("café");
    const decomposed = normalizeTagLabel("café");
    expect(decomposed.label).toBe("café");
    expect(decomposed.normalizedLabel).toBe(composed.normalizedLabel);
  });

  it("rejects control characters, empty labels, and labels over 40 characters", () => {
    expect(() => normalizeTagLabel("bad\u0000label")).toThrow(/control/i);
    expect(() => normalizeTagLabel("tab\there")).toThrow(/control/i);
    expect(() => normalizeTagLabel("   ")).toThrow(/empty|between 1 and 40/i);
    expect(() => normalizeTagLabel("x".repeat(41))).toThrow(/40/);
    expect(normalizeTagLabel("x".repeat(40)).label).toHaveLength(40);
    // Length is measured after normalization, so surrounding padding does not count.
    expect(normalizeTagLabel(`  ${"y".repeat(40)}  `).label).toHaveLength(40);
  });

  it("rejects non-string input", () => {
    expect(() => normalizeTagLabel(42 as unknown as string)).toThrow();
  });
});
