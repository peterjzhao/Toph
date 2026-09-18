import type { NextRequest } from "next/server";
import { resolveAccountContext } from "@/server/accounts/service";
import { readRuntimeConfig } from "@/server/farm-context";
import { readJsonBody } from "@/server/http/body";
import { assertWriteOrigin } from "@/server/http/origin";
import { errorResponse, handleRoute, jsonResponse, toApiError } from "@/server/http/responses";
import { TranscriptionError } from "@/server/recordings/audio";
import { generateReport, listReports } from "@/server/reports/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/reports: the farm's saved reports, newest first, without their documents. */
export async function GET(request: NextRequest): Promise<Response> {
  return handleRoute(async () => jsonResponse({ data: await listReports(await resolveAccountContext(request, "admin")) }));
}

/** POST /api/reports with `{ kind, name, from, to }`: prepares, freezes and returns one report. */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    assertWriteOrigin(request, readRuntimeConfig().appOrigin);
    const ctx = await resolveAccountContext(request, "admin");
    const body = await readJsonBody(request);
    // Without a server key the report still uses every recorded value, and says so.
    const apiKey = process.env.OPENAI_API_KEY?.trim() || null;
    return jsonResponse({ data: await generateReport(ctx, body, { apiKey, signal: request.signal }) }, { status: 201 });
  } catch (cause) {
    if (cause instanceof TranscriptionError) return jsonResponse({ error: { code: cause.code, message: cause.message } }, { status: cause.status });
    return errorResponse(toApiError(cause));
  }
}
