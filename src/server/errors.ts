/**
 * Typed application errors mapped to the documented HTTP error envelope:
 * { "error": { "code": "...", "message": "...", "fields": { ... } } }
 *
 * Messages and field notes are written for API consumers and never contain credentials,
 * connection details, or internal exception text.
 */
export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "NAME_TAKEN"
  | "VALIDATION_ERROR"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "TAG_LIMIT_REACHED"
  | "REVISION_CONFLICT"
  | "MESSAGE_CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "DATABASE_UNAVAILABLE"
  | "NOT_CONFIGURED"
  | "INTERNAL_ERROR";

export type ApiErrorBody = {
  error: { code: ApiErrorCode; message: string; fields?: Record<string, string> };
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly fields: Record<string, string> | undefined;

  constructor(status: number, code: ApiErrorCode, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  toBody(): ApiErrorBody {
    return {
      error: this.fields ? { code: this.code, message: this.message, fields: this.fields } : { code: this.code, message: this.message },
    };
  }
}

export const validationError = (message: string, fields?: Record<string, string>): ApiError =>
  new ApiError(400, "VALIDATION_ERROR", message, fields);

export const forbidden = (message: string): ApiError => new ApiError(403, "FORBIDDEN", message);

export const notFound = (message: string): ApiError => new ApiError(404, "NOT_FOUND", message);

export const tagLimitReached = (limit: number): ApiError =>
  new ApiError(409, "TAG_LIMIT_REACHED", `A log can have at most ${limit} tags.`);

export const payloadTooLarge = (maxBytes: number): ApiError =>
  new ApiError(413, "PAYLOAD_TOO_LARGE", `Request body must be at most ${maxBytes} bytes.`);

export const unsupportedMediaType = (): ApiError =>
  new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Request body must be JSON (Content-Type: application/json).");

export const databaseUnavailable = (message = "The database is not available."): ApiError =>
  new ApiError(503, "DATABASE_UNAVAILABLE", message);

export const notConfigured = (message: string): ApiError => new ApiError(503, "NOT_CONFIGURED", message);

export const internalError = (): ApiError => new ApiError(500, "INTERNAL_ERROR", "Unexpected server error.");

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
