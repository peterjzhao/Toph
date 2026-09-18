import type { NextRequest } from "next/server";
import { resolveAccountContext } from "@/server/accounts/service";
import { validationError } from "@/server/errors";
import { readJsonBody } from "@/server/http/body";
import { assertWebWrite } from "@/server/http/origin";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { getWorkspace, patchWorkspace } from "@/server/workspace/service";
import { MAX_WORKSPACE_BODY_BYTES } from "@/server/workspace/validation";

export const dynamic = "force-dynamic";

function assertNoQuery(request: NextRequest): void {
  if (request.nextUrl.searchParams.size) throw validationError("Workspace endpoints do not accept query parameters.");
}

export async function GET(request: NextRequest): Promise<Response> {
  return handleRoute(async () => {
    assertNoQuery(request);
    return jsonResponse(await getWorkspace(await resolveAccountContext(request, "admin")));
  });
}

export async function PATCH(request: NextRequest): Promise<Response> {
  return handleRoute(async () => {
    assertNoQuery(request);
    assertWebWrite(request);
    const body = await readJsonBody(request, MAX_WORKSPACE_BODY_BYTES);
    return jsonResponse(await patchWorkspace(await resolveAccountContext(request, "admin"), body));
  });
}
