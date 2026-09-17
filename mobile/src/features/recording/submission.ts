import type { PreparedSubmission } from "@/lib/api/mobile-client";
import type { RecordingDraft } from "./local-drafts";
import { isTreatment } from "./recording-utils";

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

/** Pure adapter; neither reads storage nor sends data. Requires a real catalog field ID. */
export function prepareLogSubmission(draft: RecordingDraft, fieldId: string): PreparedSubmission {
  if (!uuid.test(draft.id) || !uuid.test(fieldId)) throw new Error("A draft UUID and a field UUID are required.");
  if (draft.isDemo) throw new Error("Sample recordings cannot be submitted as real work logs.");
  if ((draft.clips?.length ?? 0) > 1) throw new Error("Multi-clip sync is not connected yet. Keep all recordings in this device draft.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.workDate) ||
      !Number.isFinite(Date.parse(`${draft.workDate}T00:00:00Z`)) ||
      new Date(`${draft.workDate}T00:00:00Z`).toISOString().slice(0, 10) !== draft.workDate) {
    throw new Error("Choose a valid work date.");
  }
  const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!clock.test(draft.startTime) || !clock.test(draft.endTime) || draft.endTime <= draft.startTime) {
    throw new Error("Choose valid start and end times on the work date, with end after start.");
  }
  if (!draft.activity.trim() || (!draft.audio && !draft.notes.trim())) throw new Error("Add an activity and a note or recording.");
  const treatment = isTreatment(draft.activity.trim());
  const amount = treatment && draft.amount.trim() ? Number(draft.amount) : null;
  if (amount !== null && (!Number.isFinite(amount) || amount <= 0 || !draft.unit.trim())) {
    throw new Error("Enter a positive treatment amount and its unit.");
  }
  if (draft.audio && (!Number.isFinite(draft.durationSeconds) || draft.durationSeconds <= 0 ||
      !draft.audio.uri.startsWith("file://") || !/^audio\/[\w.+-]+$/.test(draft.audio.mimeType) ||
      !/^[a-z0-9]{1,8}$/i.test(draft.audio.extension))) {
    throw new Error("The saved audio file and a positive recording duration are required.");
  }
  const tags = [...new Set(draft.tags.map(tag => tag.trim()).filter(Boolean))];
  if (tags.length > 10 || tags.some(tag => [...tag].length > 40)) throw new Error("Use at most ten tags of forty characters each.");
  return {
    metadata: {
      contractVersion: "1",
      clientDraftId: draft.id,
      fieldId,
      activity: draft.activity.trim(),
      workDate: draft.workDate,
      startTime: draft.startTime,
      endTime: draft.endTime,
      notes: draft.notes.trim(),
      transcript: draft.transcript?.trim() || null,
      treatment: treatment && (draft.product.trim() || amount !== null) ? {
        product: draft.product.trim() || null, amount, unit: amount !== null ? draft.unit.trim() : null,
      } : null,
      tags,
      recording: draft.audio ? { mimeType: draft.audio.mimeType, durationSeconds: draft.durationSeconds } : null,
    },
    audio: draft.audio ? { ...draft.audio } : null,
  };
}
