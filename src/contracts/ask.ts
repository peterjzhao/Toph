import { z } from "zod";

/** POST /api/logs/ask body. The question is data for the model, never instructions to the server. */
export const askFarmRequestSchema = z.object({
  question: z.string().trim().min(3).max(500),
}).strict();
export type AskFarmRequest = z.infer<typeof askFarmRequestSchema>;

/** The model's structured reply. Cited IDs are checked against the logs it was given. */
export const askFarmAnswerSchema = z.object({
  answer: z.string().max(2000),
  citedLogIds: z.array(z.string()).max(12),
}).strict();

export type AskFarmResult = {
  answer: string;
  /** Only IDs of this farm's logs that were supplied to the model, in the model's order. */
  citedLogIds: string[];
  /** How many logs the answer could draw on; below the farm total when `truncated`. */
  consideredLogs: number;
  truncated: boolean;
};
export type AskFarmResponse = { data: AskFarmResult };
