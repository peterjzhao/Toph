import { z } from "zod";
import { validationError } from "@/server/errors";

/** Names are intentionally the sole sign-in credential in this project's simplified model. */
export function normalizeAccountName(value: string): { name: string; normalizedName: string } {
  const name = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!name || [...name].length > 80 || /[\p{Cc}\p{Cf}]/u.test(name)) throw validationError("Use a name between 1 and 80 characters.", { name: "Enter your unique name." });
  return { name, normalizedName: name.toLowerCase() };
}

const client = z.enum(["web", "mobile"]).default("web");
const name = z.string().min(1).max(320);
const timezone = z.string().max(80).default("America/Los_Angeles").refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}, "Choose a valid timezone.");
export const signupSchema = z.object({ name, farmName: z.string().trim().min(1).max(120), timezone, client }).strict();
export const loginSchema = z.object({ name, client }).strict();
export const joinSchema = z.object({ name, code: z.string().trim().regex(/^[A-Za-z0-9]{12}$/).transform(value => value.toUpperCase()), client }).strict();
export const sampleSchema = z.object({ client }).strict();
export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw validationError("Check the entered details.", Object.fromEntries(parsed.error.issues.map(issue => [issue.path.join("."), issue.message])));
  return parsed.data;
}
