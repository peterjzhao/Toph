import "server-only";
/**
 * Dashboard corrections to a log's structured details. The farm's resolved log form decides
 * which keys and values are valid, the same way it does for the phone and the extraction model.
 */
import { z } from "zod";
import type { LogDto } from "@/contracts/dashboard";
import { checkLogDetails, resolveLogForm, type LogDetailValue } from "@/contracts/log-form";
import type { FarmContext } from "@/server/farm-context";
import { notFound, validationError } from "@/server/errors";
import { decodeDetails } from "@/server/mobile/logs";
import { parseUuid } from "@/server/validation/ids";
import { getWorkspace } from "@/server/workspace/service";
import { getLog } from "./dashboard";

const bodySchema = z.object({
  details: z.record(z.string().min(1).max(60), z.union([z.string().max(200), z.number().finite(), z.null()])).refine(value => Object.keys(value).length <= 80),
}).strict();

export async function updateLogDetails(ctx: FarmContext, logId: string, body: unknown): Promise<LogDto> {
  const id = parseUuid(logId, "logId");
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) throw validationError("Send the details to change.", { details: "Provide an object of field keys and values." });
  const form = resolveLogForm((await getWorkspace(ctx)).data.logForm);
  await ctx.sql.begin(async tx => {
    const [log] = await tx`select activity, details from toph.work_logs where farm_id = ${ctx.farmId} and id = ${id} for update`;
    if (!log) throw notFound("Log not found.");
    const current = decodeDetails(log.details);
    const known = new Set((form[log.activity]?.fields ?? []).map(field => field.key));
    // Values saved under an earlier form stay as they are; they can be cleared but not rewritten.
    const retired = Object.fromEntries(Object.entries(current).filter(([key]) => !known.has(key)));
    const changes: Record<string, LogDetailValue> = parsed.data.details;
    for (const key of Object.keys(retired)) {
      if (changes[key] === null) delete retired[key];
      else if (key in changes) throw validationError("Check the log details.", { [`details.${key}`]: "This farm's form no longer collects that detail; it can only be cleared." });
    }
    const edited = Object.fromEntries(Object.entries({ ...current, ...changes }).filter(([key]) => known.has(key) || !(key in current)));
    const { details, problems } = checkLogDetails(form, log.activity, edited);
    if (problems.length) throw validationError("Check the log details.", Object.fromEntries(problems.map(problem => [`details.${problem.key}`, problem.message])));
    // The worker's summary and transcript stay as submitted; only the structured values change.
    await tx`update toph.work_logs set details = ${JSON.stringify({ ...retired, ...details })}::jsonb, updated_at = now() where farm_id = ${ctx.farmId} and id = ${id}`;
  });
  return getLog(ctx, id);
}
