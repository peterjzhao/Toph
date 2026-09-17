import { z } from "zod";
import { workUnits, workActivities, workTags } from "./recording";

/** The structured recording result. Null means the speaker did not establish that fact. */
export const extractedLogSchema = z.object({
  fieldId: z.string().nullable(),
  activity: z.enum(workActivities).nullable(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  notes: z.string().max(5000).nullable(),
  product: z.string().max(120).nullable().describe("The activity's named product, crop/variety (including trees), seed, method, equipment, operation, or test type. Free text; no existing dropdown choice is required."),
  amount: z.number().positive().max(1e9).nullable(),
  unit: z.enum(workUnits).nullable(),
  tags: z.array(z.enum(workTags)).max(3),
}).strict();
export type ExtractedLogFields = z.infer<typeof extractedLogSchema>;
export type TranscriptionContext = { accountId: string; referenceDate: string; previousTranscript?: string };
export type TranscriptionResult = {
  /** This clip's speech, retained even if field extraction fails. */
  text: string;
  /** All clips, in order, used to extract one coherent work log. */
  transcript: string;
  fields: ExtractedLogFields | null;
  missingFields: (keyof ExtractedLogFields)[];
  extractionError: string | null;
};
export type TranscriptionResponse = { data: TranscriptionResult };
