import type { NextRequest } from "next/server";
import { resolveAccountContext } from "@/server/accounts/service";
import { readJsonBody } from "@/server/http/body";
import { assertWebWrite } from "@/server/http/origin";
import { handleRoute, jsonResponse } from "@/server/http/responses";
import { openAiKey } from "@/server/openai";
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
  return handleRoute(async () => {
    assertWebWrite(request);
    const ctx = await resolveAccountContext(request, "admin");
    const body = await readJsonBody(request);
    // Without a server key the report still uses every recorded value, and says so.
    return jsonResponse({ data: await generateReport(ctx, body, { apiKey: openAiKey(), signal: request.signal }) }, { status: 201 });
  });
}
