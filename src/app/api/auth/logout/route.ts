import { assertAccountWrite, logoutAccount, sessionCookie } from "@/server/accounts/service";
import { handleRoute, jsonResponse } from "@/server/http/responses";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleRoute(async () => {
    assertAccountWrite(request); await logoutAccount(request);
    return jsonResponse({ data: { signedOut: true } }, { headers: { "Set-Cookie": sessionCookie("", request, true) } });
  });
}
