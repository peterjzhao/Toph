import { z } from "zod";

/** Rendered views of the same scene. "infrared" is the false-colour near-infrared composite. */
export const LAYERS = ["true-colour", "infrared", "ndvi"] as const;
export type Layer = (typeof LAYERS)[number];
export const isLayer = (value: unknown): value is Layer => LAYERS.includes(value as Layer);

/** One Sentinel-2 pass over the farm, with scene cloud cover low enough to show the ground. */
export type TimelinePassDto = { date: string; cloudCover: number };

export type FieldTimelineDto = {
  /** Null when the farm's map has no geographic extent; the map page then shows only its saved aerial. */
  extent: { minX: number; minY: number; maxX: number; maxY: number; source: "capture" | "located" | "placeholder" } | null;
  /** The farm's own date. The slider's last stop, which shows the saved aerial rather than a pass. */
  today: string;
  /** Every usable pass since the archive began, oldest first. */
  passes: TimelinePassDto[];
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
