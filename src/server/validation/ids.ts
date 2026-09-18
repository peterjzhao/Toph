import { validationError } from "@/server/errors";

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Validates a path/body identifier and returns it lowercased; throws a 400 ApiError otherwise. */
export function parseUuid(value: unknown, field: string): string {
  if (!isUuid(value)) {
    throw validationError(`${field} must be a UUID.`, { [field]: "must be a UUID" });
  }
  return value.toLowerCase();
}
