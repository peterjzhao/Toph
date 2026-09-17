import "server-only";
import type { AuthClient } from "@/contracts/accounts";
import { readJsonBody } from "@/server/http/body";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { assertAccountWrite, joinFarm, loginAccount, sessionCookie, signupFarm } from "./service";
import { joinSchema, loginSchema, parseInput, signupSchema } from "./validation";

export function authMutation(request: Request, action: "signup" | "join" | "login") {
  return handleRoute(async () => {
    const body = await readJsonBody(request);
    let client: AuthClient;
    let result: Awaited<ReturnType<typeof signupFarm>>;
    if (action === "signup") {
      const input = parseInput(signupSchema, body); client = input.client;
      assertAccountWrite(request, client); result = await signupFarm(input);
    } else if (action === "join") {
      const input = parseInput(joinSchema, body); client = input.client;
      assertAccountWrite(request, client); result = await joinFarm(input);
    } else {
      const input = parseInput(loginSchema, body); client = input.client;
      assertAccountWrite(request, client); result = await loginAccount(input);
    }
    return jsonResponse({ data: { ...result.session, ...(client === "mobile" ? { token: result.token } : {}) } },
      { status: action === "signup" || action === "join" ? 201 : 200, headers: client === "web" ? { "Set-Cookie": sessionCookie(result.token, request) } : {} });
  });
}
