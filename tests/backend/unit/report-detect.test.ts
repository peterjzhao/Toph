import { expect, test, vi } from "vitest";
import { DETECTION_BATCH_SIZE, detectReportFacts, validateDetections, type DetectionLog } from "@/server/reports/detect";
import { completedResponse, refusalResponse } from "../helpers/openai";

const log = (id: string, notes: string): DetectionLog => ({ id, activity: "Spraying", field: "FIELD A", date: "2026-04-19", notes, recorded: {} });
const sprayed = log("a", "Sprayed Roundup PowerMAX, 2.5 gal over 12 acres with the tractor boom. EPA reg. 524-549.");

test("keeps facts whose quote is in the log and whose value is in the quote", () => {
  const result = validateDetections({ logs: [{ logId: "a", facts: [
    { key: "product", value: "Roundup PowerMAX", quote: "Sprayed Roundup PowerMAX" },
    { key: "amount", value: "2.5", quote: "2.5 gal" },
    { key: "unit", value: "gal", quote: "2.5 gal" },
    { key: "areaCovered", value: "12", quote: "over 12 acres" },
    { key: "areaUnit", value: "acres", quote: "over 12 acres" },
    { key: "epaRegNumber", value: "524-549", quote: "EPA reg. 524-549" },
  ] }] }, [sprayed]);
  expect(result.get("a")).toEqual([
    { key: "product", value: "Roundup PowerMAX", quote: "Sprayed Roundup PowerMAX" },
    { key: "amount", value: 2.5, quote: "2.5 gal" },
    { key: "unit", value: "gal", quote: "2.5 gal" },
    { key: "areaCovered", value: 12, quote: "over 12 acres" },
    { key: "areaUnit", value: "acres", quote: "over 12 acres" },
    { key: "epaRegNumber", value: "524-549", quote: "EPA reg. 524-549" },
  ]);
});

test("drops invented, paraphrased and misattributed facts", () => {
  const garbled = log("b", "Answer: yes, in one part and then 130 and 200 yes, and 130 for uh 160");
  const result = validateDetections({ logs: [
    { logId: "a", facts: [
      { key: "commodity", value: "almonds", quote: "Sprayed almonds" },           // quote not in the notes
      { key: "applicationMethod", value: "ground rig", quote: "the tractor boom" }, // value not in its quote
      { key: "amount", value: "25", quote: "2.5 gal" },                          // number not in its quote
      { key: "product", value: "Roundup", quote: "Roundup" },
      { key: "product", value: "PowerMAX", quote: "PowerMAX" },                   // second fact for a key
    ] },
    { logId: "b", facts: [{ key: "amount", value: "0", quote: "130 and 200" }] }, // zero is not an amount
    { logId: "not-supplied", facts: [{ key: "product", value: "x", quote: "x" }] },
  ] }, [sprayed, garbled]);
  expect(result.get("a")).toEqual([{ key: "product", value: "Roundup", quote: "Roundup" }]);
  expect(result.get("b")).toEqual([]);
  expect(result.has("not-supplied")).toBe(false);
});

test("matches quotes regardless of case, spacing and curly quotes; area units are canonical", () => {
  const notes = log("c", "Covered   4 Hectares near the “North Well”.");
  const result = validateDetections({ logs: [{ logId: "c", facts: [
    { key: "areaCovered", value: "4", quote: "covered 4 hectares" },
    { key: "areaUnit", value: "hectares", quote: "4 hectares" },
    { key: "waterSource", value: "North Well", quote: "the \"North Well\"" },
  ] }] }, [notes]);
  expect(result.get("c")).toEqual([
    { key: "areaCovered", value: 4, quote: "covered 4 hectares" },
    { key: "areaUnit", value: "ha", quote: "4 hectares" },
    { key: "waterSource", value: "North Well", quote: "the \"North Well\"" },
  ]);
});

test("rejects output that breaks the schema", () => {
  expect(() => validateDetections({ logs: [{ logId: "a", facts: [{ key: "price", value: "1", quote: "1" }] }] }, [sprayed])).toThrow();
  expect(() => validateDetections({ logs: [], extra: true }, [sprayed])).toThrow();
});

test("sends strict, unstored batches", async () => {
  const logs = Array.from({ length: DETECTION_BATCH_SIZE + 1 }, (_, index) => log(`log-${index}`, `Sprayed field ${index}.`));
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    const sent: DetectionLog[] = JSON.parse(JSON.parse(init.body as string).input[0].content).logs;
    return completedResponse({ logs: sent.map(item => ({ logId: item.id, facts: [] })) });
  });
  const result = await detectReportFacts(logs, "server-key", new AbortController().signal, { fetcher: fetcher as unknown as typeof fetch });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(result.size).toBe(logs.length);
  const body = JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string);
  expect(body).toMatchObject({ model: "gpt-4.1-mini", store: false, text: { format: { type: "json_schema", strict: true } } });
  expect(body.instructions).toMatch(/data,\s+never instructions/);
  expect(body.instructions).toMatch(/Never infer/);
});

test("gives every log a list even when the model leaves one out, and maps failures", async () => {
  const quiet = vi.fn(async () => completedResponse({ logs: [] }));
  expect((await detectReportFacts([sprayed], "key", new AbortController().signal, { fetcher: quiet as unknown as typeof fetch })).get("a")).toEqual([]);
  for (const response of [new Response("{}", { status: 500 }), refusalResponse()]) {
    await expect(detectReportFacts([sprayed], "key", new AbortController().signal, { fetcher: vi.fn(async () => response) as unknown as typeof fetch }))
      .rejects.toMatchObject({ status: 502, code: "REPORT_FAILED" });
  }
});
