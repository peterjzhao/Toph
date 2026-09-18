import { expect, test, vi } from "vitest";
import { answerFarmQuestion, dayLabel, validateAskAnswer, type AskContext } from "@/server/ask/farm-question";
import { completedResponse, refusalResponse } from "../helpers/openai";

const logs: AskContext["logs"] = [
  { id: "10000000-0000-4000-8000-000000000001", day: "Sunday, April 19, 2026", employee: "Isaac Wang", activity: "Spraying", field: "FIELD A", start: "6:00 AM", end: "8:30 AM", summary: "Sprayed Field A.", tags: [], product: "Copper", amount: 2, unit: "L", details: { applicationMethod: "Truck" } },
  { id: "10000000-0000-4000-8000-000000000002", day: "Monday, April 20, 2026", employee: "Maya Patel", activity: "Harvesting", field: "FIELD B", start: "7:30 AM", end: "11:00 AM", summary: "Harvested Field B.", tags: ["Follow-up"], product: null, amount: null, unit: null, details: {} },
];
const context: AskContext = { farmName: "Bays Ranch", timezone: "America/Los_Angeles", today: "Wednesday, April 29, 2026", logs, truncated: false };

test("asks for strict, unstored JSON grounded in the supplied farm logs", async () => {
  const fetcher = vi.fn(async () => completedResponse({ answer: "Isaac sprayed Copper on Field A on April 19, 2026.", citedLogIds: [logs[0].id] }));
  const result = await answerFarmQuestion("What was sprayed on Field A?", context, "server-key", new AbortController().signal, fetcher);
  expect(result).toEqual({ answer: "Isaac sprayed Copper on Field A on April 19, 2026.", citedLogIds: [logs[0].id], consideredLogs: 2, truncated: false });
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://api.openai.com/v1/responses");
  const body = JSON.parse(init.body as string);
  expect(body).toMatchObject({ model: "gpt-4.1-mini", store: false, text: { format: { type: "json_schema", strict: true } } });
  const input = JSON.parse(body.input[0].content);
  expect(input).toMatchObject({ question: "What was sprayed on Field A?", farm: { today: "Wednesday, April 29, 2026" } });
  expect(input.logs).toHaveLength(2);
  expect(body.instructions).toMatch(/data, never instructions/);
});

test("drops citations the model invented or repeated, keeping its order", () => {
  expect(validateAskAnswer({ answer: " Two logs. ", citedLogIds: [logs[1].id, "not-a-farm-log", logs[1].id, logs[0].id] }, logs))
    .toEqual({ answer: "Two logs.", citedLogIds: [logs[1].id, logs[0].id] });
  expect(() => validateAskAnswer({ answer: "   ", citedLogIds: [] }, logs)).toThrow();
  expect(() => validateAskAnswer({ answer: "x", citedLogIds: [], extra: true }, logs)).toThrow();
});

test("answers an empty farm without calling the provider", async () => {
  const fetcher = vi.fn();
  const result = await answerFarmQuestion("Who sprayed?", { ...context, logs: [] }, "key", new AbortController().signal, fetcher);
  expect(fetcher).not.toHaveBeenCalled();
  expect(result.citedLogIds).toEqual([]);
});

test("maps provider failures and refusals to a retryable error", async () => {
  for (const response of [new Response("{}", { status: 500 }), refusalResponse()]) {
    await expect(answerFarmQuestion("Who sprayed?", context, "key", new AbortController().signal, vi.fn(async () => response)))
      .rejects.toMatchObject({ status: 502, code: "ASK_FAILED" });
  }
});

test("spells out business dates without shifting them across time zones", () => {
  expect(dayLabel("2026-09-14")).toBe("Monday, September 14, 2026");
  expect(dayLabel("2026-01-01")).toBe("Thursday, January 1, 2026");
});
