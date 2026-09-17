import { expect, test, vi } from "vitest";
import { extractLogFields, validateExtractedLog } from "@/server/recordings/extraction";
const context = { fields: [{ id: "20000000-0000-4000-8000-000000000001", name: "FIELD A" }], referenceDate: "2026-09-16", timezone: "America/Los_Angeles" };
const fields = { fieldId: context.fields[0].id, activity: "Spraying", workDate: "2026-09-16", startTime: "06:00", endTime: "08:00", notes: "Sprayed Field A.", product: "Water", amount: 2, unit: "L", tags: ["Equipment"] };
const completed = (value: unknown) => Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
test("requests strict structured output using the farm's field catalog and no response storage", async () => {
  const fetcher = vi.fn(async () => completed(fields));
  expect(await extractLogFields("Recorded work", context, "server-key", new AbortController().signal, fetcher)).toEqual(fields);
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://api.openai.com/v1/responses");
  const body = JSON.parse(init.body as string);
  expect(body).toMatchObject({ model: "gpt-4.1-mini", store: false, text: { format: { type: "json_schema", strict: true } } });
  expect(body.text.format.schema.properties.fieldId.anyOf[0].enum).toEqual([context.fields[0].id]);
});
test("rejects invented fields, invalid calendar dates, unsupported categories and extra properties", () => {
  for (const patch of [{ fieldId: "outside-farm" }, { workDate: "2026-02-30" }, { activity: "invented" }, { unit: "buckets" }, { unknown: true }]) {
    expect(() => validateExtractedLog({ ...fields, ...patch }, context)).toThrow();
  }
});
test("keeps unknowns null and does not infer missing treatment amounts or an overnight end", () => {
  expect(validateExtractedLog({ ...fields, fieldId: null, workDate: null, endTime: "04:00", unit: null }, context)).toMatchObject({ fieldId: null, workDate: null, endTime: null, amount: null });
  expect(validateExtractedLog({ ...fields, activity: "Monitoring" }, context)).toMatchObject({ product: null, amount: null, unit: null });
});
test("handles refusals, partial JSON and schema failures as retryable extraction errors", async () => {
  for (const payload of [{ status: "incomplete", output: [] }, { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "No" }] }] }]) {
    await expect(extractLogFields("Speech", context, "key", new AbortController().signal, vi.fn(async () => Response.json(payload)))).rejects.toMatchObject({ code: "EXTRACTION_FAILED" });
  }
  await expect(extractLogFields("Speech", context, "key", new AbortController().signal, vi.fn(async () => completed({ ...fields, fieldId: "bad" })))).rejects.toMatchObject({ code: "EXTRACTION_FAILED" });
});
