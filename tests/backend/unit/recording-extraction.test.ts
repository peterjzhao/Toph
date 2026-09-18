import { expect, test, vi } from "vitest";
import { extractLogFields, validateExtractedLog } from "@/server/recordings/extraction";
import { allLogFields, resolveLogForm, type LogDetailValue } from "@/contracts/log-form";
import { completedResponse } from "../helpers/openai";
const form = resolveLogForm({ enabled: { Spraying: ["applicationMethod", "windSpeedMph"] }, hidden: {}, custom: [{ key: "custom_tank", label: "Tank", type: "select", options: ["North", "South"], activities: ["Spraying", "Planting"] }] });
const context = { fields: [{ id: "20000000-0000-4000-8000-000000000001", name: "FIELD A" }], referenceDate: "2026-09-16", timezone: "America/Los_Angeles", form };
const core = { fieldId: context.fields[0].id, activity: "Spraying", workDate: "2026-09-16", startTime: "06:00", endTime: "08:00", notes: "Sprayed Field A.", tags: ["Equipment"] };
/** The model answers every slot of the farm's form; unstated ones are null. */
const output = (details: Record<string, LogDetailValue>, patch: Record<string, unknown> = {}) =>
  ({ ...core, ...patch, details: { ...Object.fromEntries(allLogFields(form).map(field => [field.key, null])), ...details } });
const treatment = { product: "Water", amount: 2, unit: "L" };
const fields = { ...core, details: treatment, ...treatment };
test("requests strict structured output using the farm's field catalog and no response storage", async () => {
  const fetcher = vi.fn(async () => completedResponse(output(treatment)));
  expect(await extractLogFields("Recorded work", context, "server-key", new AbortController().signal, fetcher)).toEqual(fields);
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://api.openai.com/v1/responses");
  const body = JSON.parse(init.body as string);
  expect(body).toMatchObject({ model: "gpt-4.1-mini", store: false, text: { format: { type: "json_schema", strict: true } } });
  expect(body.text.format.schema.properties.fieldId.anyOf[0].enum).toEqual([context.fields[0].id]);
  // Default, farm-enabled and farm-defined fields all reach the schema and the prompt from the one form.
  const details = body.text.format.schema.properties.details;
  expect(details.required).toEqual(expect.arrayContaining(["product", "amount", "unit", "applicationMethod", "windSpeedMph", "custom_tank"]));
  expect(details.properties.targetPest).toBeUndefined();
  expect(details.additionalProperties).toBe(false);
  expect(JSON.parse(body.input[0].content).logForm.Planting.fields.map((field: { key: string }) => field.key)).toEqual(["product", "amount", "unit", "custom_tank"]);
});
test("fills farm-enabled and custom fields for the chosen activity only", () => {
  const stated = { ...treatment, applicationMethod: "Plane", windSpeedMph: 0, custom_tank: "North" };
  expect(validateExtractedLog(output(stated), context).details).toEqual(stated);
  expect(validateExtractedLog(output(stated, { activity: "Planting" }), context).details).toEqual({ product: "Water", amount: 2, custom_tank: "North" });
  expect(validateExtractedLog(output(stated, { activity: null }), context).details).toEqual({});
  expect(() => validateExtractedLog(output({ applicationMethod: "Rocket" }), context)).toThrow();
});
test("rejects invented fields, invalid calendar dates, unsupported categories and extra properties", () => {
  for (const patch of [{ fieldId: "outside-farm" }, { workDate: "2026-02-30" }, { activity: "invented" }, { unknown: true }]) {
    expect(() => validateExtractedLog(output(treatment, patch), context)).toThrow();
  }
  expect(() => validateExtractedLog(output({ ...treatment, unit: "buckets" }), context)).toThrow();
  expect(() => validateExtractedLog(output({ ...treatment, invented: "x" }), context)).toThrow();
});
test("keeps unknowns null and does not infer missing treatment amounts or an overnight end", () => {
  expect(validateExtractedLog(output({ ...treatment, unit: null }, { fieldId: null, workDate: null, endTime: "04:00" }), context)).toMatchObject({ fieldId: null, workDate: null, endTime: null, amount: 2 });
  expect(validateExtractedLog(output(treatment, { activity: "Monitoring" }), context)).toMatchObject({ product: null, amount: null, unit: null, details: {} });
});

test.each([
  ["Planting", "Oak trees", "plants"], ["Seeding", "Rye", "seeds"],
  ["Harvesting", "Apples", "crates"], ["Fertilizing", "Compost", "kg"],
])("retains %s items and quantities outside the original treatment-only form", (activity, product, unit) => {
  expect(validateExtractedLog(output({ product, amount: 20, unit }, { activity }), context)).toMatchObject({ activity, product, amount: 20, unit, details: { product, amount: 20, unit } });
});

test("an oak-tree amendment fills the crop even with no count or existing crop catalog", async () => {
  const transcript = "I was planting in Field A yesterday from 6 AM until 8 AM.\n\nI planted oak trees.";
  const patch = { activity: "Planting", notes: "Online voice log created.\n\nOak trees were planted in Field A on September 16, from 6 AM to 8 AM." };
  const fetcher = vi.fn(async () => completedResponse(output({ product: "Oak trees", unit: "plants" }, patch)));
  expect(await extractLogFields(transcript, context, "key", new AbortController().signal, fetcher))
    .toEqual({ ...core, ...patch, details: { product: "Oak trees", unit: "plants" }, product: "Oak trees", amount: null, unit: "plants" });
  const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(JSON.parse(init.body as string).input[0].content).transcript).toBe(transcript);
});

test("rejects incompatible units without deleting a known quantity or crop", () => {
  expect(validateExtractedLog(output({ product: "Oak trees", amount: 20, unit: "L" }, { activity: "Planting" }), context)).toMatchObject({ product: "Oak trees", amount: 20, unit: null });
});
test("handles refusals, partial JSON and schema failures as retryable extraction errors", async () => {
  for (const payload of [{ status: "incomplete", output: [] }, { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "No" }] }] }]) {
    await expect(extractLogFields("Speech", context, "key", new AbortController().signal, vi.fn(async () => Response.json(payload)))).rejects.toMatchObject({ code: "EXTRACTION_FAILED" });
  }
  await expect(extractLogFields("Speech", context, "key", new AbortController().signal, vi.fn(async () => completedResponse(output(treatment, { fieldId: "bad" }))))).rejects.toMatchObject({ code: "EXTRACTION_FAILED" });
});
