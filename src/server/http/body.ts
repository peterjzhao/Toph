import "server-only";
import { payloadTooLarge, unsupportedMediaType, validationError } from "@/server/errors";

/** Mutation bodies are tiny; anything larger than this is rejected before parsing. */
export const MAX_JSON_BODY_BYTES = 4096;

function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  return value.split(";")[0].trim().toLowerCase() === "application/json";
}

/**
 * Reads a JSON request body with a hard byte limit that applies whether or not the client sent
 * Content-Length. Throws 415 for non-JSON content types, 413 when oversized, 400 when empty,
 * not UTF-8, or not valid JSON.
 */
export async function readJsonBody(request: Request, maxBytes: number = MAX_JSON_BODY_BYTES): Promise<unknown> {
  if (!isJsonContentType(request.headers.get("content-type"))) throw unsupportedMediaType();

  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isInteger(length) || length < 0) {
      throw validationError("Invalid Content-Length header.", { "content-length": "must be a non-negative integer" });
    }
    if (length > maxBytes) throw payloadTooLarge(maxBytes);
  }

  if (!request.body) throw validationError("Request body must be a JSON object.", { body: "is required" });

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw payloadTooLarge(maxBytes);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (bytes.byteLength === 0) throw validationError("Request body must be a JSON object.", { body: "is required" });

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw validationError("Request body must be UTF-8 encoded JSON.", { body: "invalid encoding" });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw validationError("Request body is not valid JSON.", { body: "invalid JSON" });
  }
}

/** Validates the POST /api/logs/:logId/tags body: exactly `{ "label": string }`. */
export function parseAddTagBody(body: unknown): { label: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw validationError("Request body must be a JSON object with a label.", { body: "must be an object" });
  }
  const record = body as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const key of Object.keys(record)) {
    if (key !== "label") fields[key] = "is not allowed";
  }
  if (!("label" in record)) fields.label = "is required";
  else if (typeof record.label !== "string") fields.label = "must be a string";
  if (Object.keys(fields).length > 0) throw validationError("Invalid tag request body.", fields);
  return { label: record.label as string };
}
