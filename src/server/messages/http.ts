import "server-only";
import { resolveAccountContext } from "@/server/accounts/service";
import { validationError } from "@/server/errors";
import { readRuntimeConfig } from "@/server/farm-context";
import { readJsonBody } from "@/server/http/body";
import { assertWriteOrigin } from "@/server/http/origin";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { requireMobileAccess } from "@/server/mobile/access";
import { getMessages, readMessages, sendMessage } from "./service";

export function messageRoute(request: Request, client: "web" | "mobile", action: "list" | "send" | "read") {
  return handleRoute(async () => {
    if (new URL(request.url).searchParams.size) throw validationError("Messaging endpoints do not accept query parameters.");
    if (client === "mobile") requireMobileAccess(request, action !== "list");
    else if (action !== "list") assertWriteOrigin(request, readRuntimeConfig().appOrigin);
    const ctx = await resolveAccountContext(request, client === "web" ? "admin" : "worker");
    const data = action === "list" ? await getMessages(ctx) : await (action === "send" ? sendMessage : readMessages)(ctx, await readJsonBody(request, action === "send" ? 20_000 : 96_000));
    return jsonResponse({ data });
  });
}
