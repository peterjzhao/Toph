import { resolveAccountContext } from "@/server/accounts/service";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { requireMobileAccess } from "@/server/mobile/access";
import { processRecording, transcriptionKey } from "@/server/recordings/process";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Speech plus validated form fields. Saving a log is a separate request. */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    requireMobileAccess(request, true);
    const ctx = await resolveAccountContext(request, "worker");
    const key = transcriptionKey();
    return jsonResponse({ data: await processRecording(request, ctx, key) });
  });
}
