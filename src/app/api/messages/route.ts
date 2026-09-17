import { messageRoute } from "@/server/messages/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => messageRoute(request, "web", "list");
export const POST = (request: Request) => messageRoute(request, "web", "send");
