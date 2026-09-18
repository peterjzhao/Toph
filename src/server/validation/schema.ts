import type { z } from "zod";
import { validationError } from "@/server/errors";

/** Parses `value`, or throws a 400 whose fields name each problem by path ("body" for the whole value). */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw validationError(message, Object.fromEntries(result.error.issues.slice(0, 20).map(issue => [issue.path.join(".") || "body", issue.message])));
  }
  return result.data;
}
