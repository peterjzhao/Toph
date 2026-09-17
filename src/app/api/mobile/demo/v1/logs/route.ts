import { resolveFarmContext } from "@/server/farm-context";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { requireMobileDemo } from "@/server/mobile-demo/access";
import { listMobileLogs, readDemoSubmission, saveMobileLog } from "@/server/mobile-demo/logs";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleRoute(async () => {
    requireMobileDemo(request);
    return jsonResponse({ data: await listMobileLogs(await resolveFarmContext(), new URL(request.url).searchParams.get("accountId") ?? "") });
  });
}
export async function POST(request: Request) {
  return handleRoute(async () => {
    requireMobileDemo(request, true);
    const { metadata, clips } = await readDemoSubmission(request);
    return jsonResponse({ data: await saveMobileLog(await resolveFarmContext(), metadata, clips) });
  });
}
