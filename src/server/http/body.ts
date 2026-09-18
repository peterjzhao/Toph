import "server-only";
import type { z } from "zod";
import { payloadTooLarge, unsupportedMediaType, validationError } from "@/server/errors";

/** Mutation bodies are tiny; anything larger than this is rejected before parsing. */
export const MAX_JSON_BODY_BYTES = 4096;

/**
 * Reads a body into memory, throwing `tooLarge()` once it passes `maxBytes`. The limit applies to the
 * stream itself, so it also holds for chunked requests without Content-Length.
 */
export async function readLimitedBody(body: ReadableStream<Uint8Array>, maxBytes: number, tooLarge: () => Error): Promise<Blob> {
  const reader = body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return new Blob(chunks);
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      chunks.push(new Uint8Array(value));
    }
  } finally { reader.releaseLock(); }
}

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

  const bytes = new Uint8Array(await (await readLimitedBody(request.body, maxBytes, () => payloadTooLarge(maxBytes))).arrayBuffer());
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

/** Reads a JSON body that must match `schema`; a mismatch throws `invalid()`, and body errors pass through. */
export async function readJsonBodyAs<T>(request: Request, schema: z.ZodType<T>, invalid: () => Error, maxBytes?: number): Promise<T> {
  const parsed = schema.safeParse(await readJsonBody(request, maxBytes));
  if (!parsed.success) throw invalid();
  return parsed.data;
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
