import { GET as accounts } from "@/app/api/mobile/v1/accounts/route";
import { legacyBootstrap } from "@/server/mobile/legacy";
export const runtime = "nodejs";
export async function GET(request: Request) { return legacyBootstrap(await accounts(request)); }
