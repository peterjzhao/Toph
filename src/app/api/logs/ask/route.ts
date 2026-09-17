import { resolveAccountContext } from "@/server/accounts/service";
import { askFarm, askKey } from "@/server/ask/farm-question";
import { readRuntimeConfig } from "@/server/farm-context";
import { assertWriteOrigin } from "@/server/http/origin";
import { toApiError } from "@/server/http/responses";
import { TranscriptionError } from "@/server/recordings/audio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };

/** POST /api/logs/ask with `{ "question": "..." }`: an answer grounded in the admin's own farm logs. */
export async function POST(request: Request): Promise<Response> {
  try {
    assertWriteOrigin(request, readRuntimeConfig().appOrigin);
    const ctx = await resolveAccountContext(request, "admin");
    const key = askKey();
    return Response.json({ data: await askFarm(request, ctx, key) }, { headers });
  } catch (cause) {
    const error = cause instanceof TranscriptionError ? cause : toApiError(cause);
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status, headers });
  }
}
