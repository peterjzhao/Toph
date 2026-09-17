import type { RecordingDraft } from "../local-drafts";
import { prepareLogSubmission } from "../submission";

const fieldId = "20000000-0000-4000-8000-000000000001";
const draft: RecordingDraft = {
  id: "40000000-0000-4000-8000-000000000001", createdAt: "2026-09-16T20:00:00Z", updatedAt: "2026-09-16T21:00:00Z",
  employee: { id: "local-profile", name: "Worker" }, farmId: "untrusted-local-farm", field: "FIELD A",
  activity: "Spraying", workDate: "2026-04-19", startTime: "06:00", endTime: "10:40",
  notes: " Finished the field. ", product: "Example product", amount: "2.5", unit: "L",
  tags: ["Needs review"], transcript: " Finished the field. ",
  audio: { uri: "file:///drafts/log.m4a", mimeType: "audio/mp4", extension: "m4a" }, durationSeconds: 12, isDemo: false,
};

test("preserves captured details without trusting local identity or leaking device paths", () => {
  const before = JSON.stringify(draft);
  const result = prepareLogSubmission(draft, fieldId);
  expect(result.metadata).toMatchObject({ clientDraftId: draft.id, fieldId, notes: "Finished the field.", transcript: "Finished the field.", workDate: draft.workDate, startTime: "06:00", endTime: "10:40", treatment: { product: "Example product", amount: 2.5, unit: "L" } });
  expect(result.metadata).not.toHaveProperty("employee");
  expect(result.metadata).not.toHaveProperty("farmId");
  expect(JSON.stringify(result.metadata)).not.toContain("file://");
  expect(result.audio).toEqual(draft.audio);
  expect(JSON.stringify(draft)).toBe(before);
});

test("notes-only logs omit audio and stale treatment fields for another activity", () => {
  const result = prepareLogSubmission({ ...draft, activity: "Harvesting", audio: null }, fieldId);
  expect(result.audio).toBeNull();
  expect(result.metadata.recording).toBeNull();
  expect(result.metadata.treatment).toBeNull();
});

test.each([
  { isDemo: true }, { id: "preview-id" }, { workDate: "2026-02-30" }, { endTime: "05:00" },
  { startTime: "25:00" }, { amount: "NaN" }, { durationSeconds: 0 },
  { audio: null, notes: "" }, { tags: Array.from({ length: 11 }, (_, i) => `Tag ${i}`) },
])("rejects invalid drafts before transport: %j", changes => {
  expect(() => prepareLogSubmission({ ...draft, ...changes }, fieldId)).toThrow();
});

test("does not invent a field UUID from the local label", () => {
  expect(() => prepareLogSubmission(draft, "FIELD A")).toThrow("field UUID");
});
