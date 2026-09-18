import { resolveAccountContext } from "@/server/accounts/service";
import { askFarm, askKey } from "@/server/ask/farm-question";
import { assertWebWrite } from "@/server/http/origin";
import { handleRoute, jsonResponse } from "@/server/http/responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/logs/ask with `{ "question": "..." }`: an answer grounded in the admin's own farm logs. */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    assertWebWrite(request);
    const ctx = await resolveAccountContext(request, "admin");
    const key = askKey();
    return jsonResponse({ data: await askFarm(request, ctx, key) });
  });
}
