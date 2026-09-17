import "server-only";
/**
 * Thin HTTP helpers for the Route Handlers: JSON envelopes, `Cache-Control: no-store`, and
 * one place that turns any thrown error into the documented, sanitized error envelope.
 */
import { mapDatabaseError, redactConnectionStrings } from "@/server/db/errors";
import { ApiError, internalError, isApiError } from "@/server/errors";

export function jsonResponse(body: unknown, init: { status?: number; headers?: HeadersInit } = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { status: init.status ?? 200, headers });
}

export function errorResponse(error: ApiError): Response {
  return jsonResponse(error.toBody(), { status: error.status });
}

function logServerError(kind: "database" | "unexpected", error: unknown): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  const suffix = typeof code === "string" ? ` (${code})` : "";
  console.error(`[toph-api] ${kind} error${suffix}: ${redactConnectionStrings(message)}`);
}

/** Maps any error to an ApiError. Expected 4xx/5xx ApiErrors pass through; everything else is sanitized. */
export function toApiError(error: unknown): ApiError {
  if (isApiError(error)) return error;
  const mapped = mapDatabaseError(error);
  if (mapped) {
    logServerError("database", error);
    return mapped;
  }
  logServerError("unexpected", error);
  return internalError();
}

export async function handleRoute(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    return errorResponse(toApiError(error));
  }
}
