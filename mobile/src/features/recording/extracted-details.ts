import type { ExtractedLogFields } from "@toph/contracts/transcription";
import type { WorkDetails } from "./recording-utils";

/** A worker's explicit edits win over asynchronous or appended-recording suggestions. */
export function applyExtractedDetails(current: WorkDetails, fields: ExtractedLogFields, catalog: { id: string; name: string }[], edited: ReadonlySet<keyof WorkDetails>, previous?: ExtractedLogFields | null): WorkDetails {
  const patch: Partial<WorkDetails> = {};
  const field = catalog.find(item => item.id === fields.fieldId);
  if (field && !edited.has("field")) patch.field = field.name;
  else if (fields.fieldId === null && previous?.fieldId && !edited.has("field") && current.field === catalog.find(item => item.id === previous.fieldId)?.name) patch.field = "";
  for (const key of ["activity", "workDate", "startTime", "endTime", "notes", "product", "unit"] as const) {
    if (fields[key] !== null && !edited.has(key)) patch[key] = fields[key];
    else if (fields[key] === null && previous?.[key] != null && current[key] === previous[key] && !edited.has(key)) patch[key] = "";
  }
  if (fields.amount !== null && !edited.has("amount")) patch.amount = String(fields.amount);
  else if (previous?.amount != null && current.amount === String(previous.amount) && !edited.has("amount")) patch.amount = "";
  if (!edited.has("tags")) patch.tags = fields.tags;
  return { ...current, ...patch };
}
