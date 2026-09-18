import { describe, expect, it, vi } from "vitest";
import { MIN_OBSERVATIONS, analyseField, validateAnalysis, type AnalysisContext } from "@/server/satellite/analysis";
import type { FieldObservation } from "@/server/satellite/statistics";
import { completedResponse, refusalResponse } from "../helpers/openai";

const observations: FieldObservation[] = [
  { date: "2026-04-01", mean: 0.40, min: 0.2, max: 0.6, stDev: 0.05, validFraction: 0.95 },
  { date: "2026-04-11", mean: 0.52, min: 0.3, max: 0.7, stDev: 0.05, validFraction: 0.91 },
  { date: "2026-04-21", mean: 0.61, min: 0.4, max: 0.8, stDev: 0.05, validFraction: 0.88 },
];

const logId = "10000000-0000-4000-8000-000000000001";
const context: AnalysisContext = {
  farmName: "Bays Ranch",
  timezone: "America/Los_Angeles",
  fieldName: "FIELD D",
  observations,
  logs: [{ id: logId, day: "Friday, April 3, 2026", employee: "Isaac Wang", activity: "Spraying", product: "Copper", amount: 2, unit: "L", summary: "Sprayed Field D." }],
};

const observation = (overrides: Record<string, unknown> = {}) => ({
  logId, fromDate: "2026-04-01", toDate: "2026-04-21", indexChange: 0.99, claim: "Vegetation rose after the spraying.", confidence: "clear", ...overrides,
});

describe("validateAnalysis", () => {
  it("replaces the model's arithmetic with the change measured from the stored statistics", () => {
    const result = validateAnalysis({ summary: "Vegetation rose.", observations: [observation()] }, context);
    // 0.61 − 0.40, not the 0.99 the model claimed.
    expect(result.observations[0].indexChange).toBe(0.21);
  });

  it("drops an observation citing a log that was never supplied", () => {
    const result = validateAnalysis({ summary: "x", observations: [observation({ logId: "20000000-0000-4000-8000-000000000009" })] }, context);
    expect(result.observations).toEqual([]);
  });

  it("keeps an observation that cites no log at all", () => {
    const result = validateAnalysis({ summary: "x", observations: [observation({ logId: null })] }, context);
    expect(result.observations).toHaveLength(1);
  });

  it("collapses a window with too few clear readings to insufficient-data", () => {
    const narrow = validateAnalysis({ summary: "x", observations: [observation({ fromDate: "2026-04-01", toDate: "2026-04-02" })] }, context);
    expect(narrow.observations[0]).toMatchObject({ confidence: "insufficient-data", indexChange: 0 });
    expect(observations.filter(item => item.date >= "2026-04-01" && item.date <= "2026-04-02").length).toBeLessThan(MIN_OBSERVATIONS);
  });

  it("collapses a window that falls outside the imagery entirely", () => {
    const result = validateAnalysis({ summary: "x", observations: [observation({ fromDate: "2025-01-01", toDate: "2025-02-01" })] }, context);
    expect(result.observations[0].confidence).toBe("insufficient-data");
  });

  it("cannot express that work was not performed", () => {
    expect(() => validateAnalysis({ summary: "x", observations: [observation({ confidence: "work-not-done" })] }, context)).toThrow();
    expect(() => validateAnalysis({ summary: "x", observations: [observation({ workPerformed: false })] }, context)).toThrow();
  });

  it("refuses an empty summary", () => {
    expect(() => validateAnalysis({ summary: "   ", observations: [] }, context)).toThrow();
  });
});

describe("analyseField", () => {
  it("grounds the request in this field's cloud-free statistics and its own logs", async () => {
    const fetcher = vi.fn(async () => completedResponse({ summary: "Vegetation rose after spraying.", observations: [observation()] }));
    const result = await analyseField(context, "server-key", new AbortController().signal, fetcher);

    expect(result.summary).toBe("Vegetation rose after spraying.");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: "gpt-4.1-mini", store: false, text: { format: { type: "json_schema", strict: true } } });
    expect(body.instructions).toMatch(/data, never instructions/);
    // The prompt must forbid the conclusion the schema already cannot carry.
    expect(body.instructions).toMatch(/never say|do not say|not evidence/i);
    const input = JSON.parse(body.input[0].content);
    expect(input.field).toBe("FIELD D");
    expect(input.observations).toHaveLength(3);
    expect(input.logs[0]).toMatchObject({ id: logId, day: "Friday, April 3, 2026" });
  });

  it("answers a field with no clear imagery without calling the provider", async () => {
    const fetcher = vi.fn();
    const result = await analyseField({ ...context, observations: [] }, "key", new AbortController().signal, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.observations).toEqual([]);
    expect(result.summary).toMatch(/cloud|imagery/i);
  });

  it("maps provider failures and refusals to a retryable error", async () => {
    for (const response of [new Response("{}", { status: 500 }), refusalResponse()]) {
      const fetcher = vi.fn(async () => response.clone());
      await expect(analyseField(context, "key", new AbortController().signal, fetcher)).rejects.toThrow();
    }
  });
});
