import { fieldAnalysisRequestSchema } from "@/contracts/satellite";
import { resolveAccountContext } from "@/server/accounts/service";
import { askKey } from "@/server/ask/farm-question";
import { validationError } from "@/server/errors";
import { readJsonBodyAs } from "@/server/http/body";
import { assertWebWrite } from "@/server/http/origin";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { fieldAnalysis } from "@/server/satellite/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/fields/analysis with `{ fieldId, from, to }`.
 *
 * Returns the readings the answer was grounded in alongside the answer, so the interface can chart
 * the evidence next to every claim rather than presenting a verdict on its own.
 */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    assertWebWrite(request);
    const ctx = await resolveAccountContext(request, "admin");
    const key = askKey();
    const body = await readJsonBodyAs(request, fieldAnalysisRequestSchema, () => validationError("Choose a field and a date range."));
    const data = await fieldAnalysis(ctx, body, key, request.signal);
    return jsonResponse({ data });
  });
}
