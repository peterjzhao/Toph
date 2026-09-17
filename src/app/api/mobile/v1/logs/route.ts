import { resolveFarmContext } from "@/server/farm-context";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { requireMobileAccess } from "@/server/mobile/access";
import { listMobileLogs, readMobileSubmission, saveMobileLog } from "@/server/mobile/logs";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleRoute(async () => {
    requireMobileAccess(request);
    return jsonResponse({ data: await listMobileLogs(await resolveFarmContext(), new URL(request.url).searchParams.get("accountId") ?? "") });
  });
}
export async function POST(request: Request) {
  return handleRoute(async () => {
    requireMobileAccess(request, true);
    const { metadata, clips } = await readMobileSubmission(request);
    return jsonResponse({ data: await saveMobileLog(await resolveFarmContext(), metadata, clips) });
  });
}
