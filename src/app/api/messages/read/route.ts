import { messageRoute } from "@/server/messages/http";
export const runtime = "nodejs";
export const POST = (request: Request) => messageRoute(request, "web", "read");
