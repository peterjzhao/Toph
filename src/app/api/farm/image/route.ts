import { resolveAccountContext } from "@/server/accounts/service";
import { notFound } from "@/server/errors";
import { handleRoute } from "@/server/http/responses";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleRoute(async () => {
    const ctx = await resolveAccountContext(request);
    const [image] = await ctx.sql`select bytes, mime_type from toph.farm_images where farm_id = ${ctx.farmId}`;
    if (!image) throw notFound("Farm image not found.");
    return new Response(new Uint8Array(image.bytes as Buffer), { headers: { "Content-Type": image.mime_type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  });
}
