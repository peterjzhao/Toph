import { resolveFarmContext } from "@/server/farm-context";
import { notFound } from "@/server/errors";
import { handleRoute } from "@/server/http/responses";
import { requireMobileAccess } from "@/server/mobile/access";
import { parseUuid } from "@/server/validation/ids";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ recordingId: string }> }) {
  return handleRoute(async () => {
    requireMobileAccess(request);
    const id = parseUuid((await context.params).recordingId, "recordingId");
    const ctx = await resolveFarmContext();
    const [row] = await ctx.sql`select bytes, mime_type from toph.mobile_recordings where farm_id = ${ctx.farmId} and id = ${id}`;
    if (!row) throw notFound("Recording not found.");
    const bytes = row.bytes as Buffer;
    const headers = { "Content-Type": row.mime_type, "Cache-Control": "private, no-store", "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff" };
    const range = request.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      let start = match?.[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match?.[2]));
      const end = match?.[1] ? Math.min(bytes.length - 1, match[2] ? Number(match[2]) : bytes.length - 1) : bytes.length - 1;
      if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || start > end || start >= bytes.length) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${bytes.length}` } });
      start = Math.max(0, start);
      return new Response(new Uint8Array(bytes.subarray(start, end + 1)), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${bytes.length}`, "Content-Length": String(end - start + 1) } });
    }
    return new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Length": String(bytes.length) } });
  });
}
