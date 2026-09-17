import { assertAccountWrite, deactivateMember, resolveAccountContext } from "@/server/accounts/service";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { parseUuid } from "@/server/validation/ids";
export const runtime = "nodejs";
export async function DELETE(request: Request, context: { params: Promise<{ accountId: string }> }) {
  return handleRoute(async () => {
    assertAccountWrite(request);
    const ctx = await resolveAccountContext(request, "admin");
    await deactivateMember(ctx, parseUuid((await context.params).accountId, "accountId"));
    return jsonResponse({ data: { removed: true } });
  });
}
