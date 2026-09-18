import { z } from "zod";

/** Rendered views of the same scene. "infrared" is the false-colour near-infrared composite. */
export const LAYERS = ["true-colour", "infrared", "ndvi"] as const;
export type Layer = (typeof LAYERS)[number];
export const isLayer = (value: unknown): value is Layer => LAYERS.includes(value as Layer);

/** One scrubber stop: a month with real imagery behind it. */
export type TimelineMonthDto = { month: string; date: string; cloudCover: number; acquisitions: number };
/** A single pass, offered when the admin stops on a month. */
export type TimelineAcquisitionDto = { date: string; cloudCover: number };

export type FieldTimelineDto = {
  /** Null when the farm's map has no geographic extent; the map page then behaves as before. */
  extent: { minX: number; minY: number; maxX: number; maxY: number; source: "capture" | "located" | "placeholder" } | null;
  months: TimelineMonthDto[];
  acquisitions: TimelineAcquisitionDto[];
  /** Log dates for the selected field, so the correlation is visible before any model runs. */
  logDates: { logId: string; date: string; activity: string }[];
};
export type FieldTimelineResponse = { data: FieldTimelineDto };

export const fieldAnalysisRequestSchema = z.object({
  fieldId: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();
export type FieldAnalysisRequest = z.infer<typeof fieldAnalysisRequestSchema>;

/**
 * The model's structured reply.
 *
 * There is deliberately no field that can assert work was or was not performed. Vegetation failing
 * to move is not evidence about a worker: crop stage, product, weather and thin cloud all produce
 * the same flat line. The strongest an observation may state is what the imagery shows.
 */
export const fieldAnalysisAnswerSchema = z.object({
  summary: z.string().max(1200),
  observations: z.array(z.object({
    logId: z.string().nullable(),
    fromDate: z.string(),
    toDate: z.string(),
    indexChange: z.number(),
    claim: z.string().max(400),
    confidence: z.enum(["clear", "possible", "insufficient-data"]),
  }).strict()).max(8),
}).strict();

export type FieldAnalysisObservation = z.infer<typeof fieldAnalysisAnswerSchema>["observations"][number];

export type FieldAnalysisResult = {
  summary: string;
  observations: FieldAnalysisObservation[];
  /** The readings the answer was grounded in, so the interface can chart what the model saw. */
  series: { date: string; value: number; validFraction: number }[];
};
export type FieldAnalysisResponse = { data: FieldAnalysisResult };
