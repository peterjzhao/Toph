import { z } from "zod";
import { workActivities, workTags } from "./recording";
import { allLogFields, type LogDetails, type ResolvedLogForm } from "./log-form";
import type { VoiceGuidance } from "./voice";

/** The fixed core of every work log. Null means the speaker did not establish that fact. */
export const extractedCoreSchema = z.object({
  fieldId: z.string().nullable(),
  activity: z.enum(workActivities).nullable(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  notes: z.string().max(5000).nullable(),
  tags: z.array(z.enum(workTags)).max(3),
}).strict();

/** The model's output: the core plus one nullable slot for every field in the farm's log form. */
export function extractionSchema(form: ResolvedLogForm) {
  const details = Object.fromEntries(allLogFields(form).map(field => {
    const value = field.type === "number" ? z.number().min(0).max(1e9) : field.type === "select" ? z.enum(field.options as [string, ...string[]]) : z.string().max(200);
    return [field.key, (field.hint ? value.describe(field.hint) : value).nullable()];
  }));
  return extractedCoreSchema.extend({ details: z.object(details).strict() }).strict();
}

export type ExtractedLogFields = z.infer<typeof extractedCoreSchema> & {
  /** Values for the chosen activity's fields, keyed as in the log form. Unstated fields are absent. */
  details: LogDetails;
  /** Mirrors of `details.product/amount/unit` for app versions that predate `details`. */
  product: string | null;
  amount: number | null;
  unit: string | null;
};
export type TranscriptionContext = { accountId: string; referenceDate: string; previousTranscript?: string };
export type TranscriptionResult = {
  /** This clip's speech, retained even if field extraction fails. */
  text: string;
  /** All clips, in order, used to extract one coherent work log. */
  transcript: string;
  fields: ExtractedLogFields | null;
  /** Required facts still unknown: core keys, then the chosen activity's required detail keys. */
  missingFields: (keyof ExtractedLogFields)[];
  extractionError: string | null;
  /** Hands-free mode: what to say next. Null when extraction failed; absent from older servers. */
  voice?: VoiceGuidance | null;
};
export type TranscriptionResponse = { data: TranscriptionResult };
