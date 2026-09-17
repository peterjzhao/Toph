import { authMutation } from "@/server/accounts/http";
export const runtime = "nodejs";
export async function POST(request: Request) { return authMutation(request, "demo"); }
