import { fieldAnalysisRequestSchema } from "@/contracts/satellite";
import { resolveAccountContext } from "@/server/accounts/service";
import { askKey } from "@/server/ask/farm-question";
import { validationError } from "@/server/errors";
import { readRuntimeConfig } from "@/server/farm-context";
import { readJsonBody } from "@/server/http/body";
import { assertWriteOrigin } from "@/server/http/origin";
import { satelliteRoute } from "@/server/satellite/http";
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
  return satelliteRoute(async () => {
    assertWriteOrigin(request, readRuntimeConfig().appOrigin);
    const ctx = await resolveAccountContext(request, "admin");
    const key = askKey();
    const body = fieldAnalysisRequestSchema.safeParse(await readJsonBody(request));
    if (!body.success) throw validationError("Choose a field and a date range.");
    const data = await fieldAnalysis(ctx, body.data, key, request.signal);
    return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
  });
}
