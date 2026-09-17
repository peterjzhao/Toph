import { applyExtractedDetails } from "../extracted-details";
import { emptyDetails } from "../recording-utils";
import { emptyExtraction } from "./transcription-fixture";
const fields = { ...emptyExtraction, fieldId: "field-b", activity: "Spraying" as const, workDate: "2026-09-16", startTime: "06:00", endTime: "08:00", notes: "Sprayed Field B.", product: "Water", amount: 2, unit: "L" as const, tags: ["Equipment" as const] };
const catalog = [{ id: "field-b", name: "FIELD B" }];
test("fills every supported category using the server's known field", () => {
  expect(applyExtractedDetails(emptyDetails, fields, catalog, new Set())).toEqual({ field: "FIELD B", activity: "Spraying", workDate: "2026-09-16", startTime: "06:00", endTime: "08:00", notes: "Sprayed Field B.", product: "Water", amount: "2", unit: "L", tags: ["Equipment"] });
});
test("keeps explicit worker edits and does not invent unknown fields", () => {
  const details = { ...emptyDetails, notes: "My correction", tags: ["Follow-up"] };
  const next = applyExtractedDetails(details, { ...fields, fieldId: "unknown" }, catalog, new Set(["notes", "tags", "startTime"]));
  expect(next).toMatchObject({ field: details.field, notes: "My correction", tags: ["Follow-up"], startTime: "" });
  expect(applyExtractedDetails(details, emptyExtraction, catalog, new Set(["tags"]))).toEqual(details);
});
test("a later spoken correction clears prior automatic treatment suggestions", () => {
  const first = applyExtractedDetails(emptyDetails, fields, catalog, new Set());
  const corrected = applyExtractedDetails(first, { ...emptyExtraction, activity: "Monitoring" }, catalog, new Set(["workDate"]), fields);
  expect(corrected).toMatchObject({ activity: "Monitoring", field: "", product: "", amount: "", unit: "", workDate: first.workDate });
});

test.each(["L", null] as const)("switching to planting uses planting units when extraction returns %s", (unit) => {
  const first = applyExtractedDetails(emptyDetails, fields, catalog, new Set());
  const planted = applyExtractedDetails(first, { ...fields, activity: "Planting", product: "Tomato", amount: 50, unit }, catalog, new Set(), fields);
  expect(planted).toMatchObject({ activity: "Planting", product: "Tomato", amount: "50", unit: "plants" });
});

test("appended suggestions for another activity cannot replace the manually selected crop", () => {
  const current = { ...emptyDetails, activity: "Planting", product: "Tomato", amount: "50", unit: "plants" };
  expect(applyExtractedDetails(current, fields, catalog, new Set(["activity"]))).toMatchObject({ activity: "Planting", product: "Tomato", amount: "50", unit: "plants" });
});
