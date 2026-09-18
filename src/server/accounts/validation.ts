import { z } from "zod";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/contracts/accounts";
import { validationError } from "@/server/errors";
import { parseOrThrow } from "@/server/validation/schema";

/** The unique name identifies the account; the password (hashed in password.ts) proves it. */
export function normalizeAccountName(value: string): { name: string; normalizedName: string } {
  const name = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!name || [...name].length > 80 || /[\p{Cc}\p{Cf}]/u.test(name)) throw validationError("Use a name between 1 and 80 characters.", { name: "Enter your unique name." });
  return { name, normalizedName: name.toLowerCase() };
}

const client = z.enum(["web", "mobile"]).default("web");
const name = z.string().min(1).max(320);
const password = z.string().min(1).max(PASSWORD_MAX_LENGTH);
const newPassword = z.string().min(PASSWORD_MIN_LENGTH, `Use a password with at least ${PASSWORD_MIN_LENGTH} characters.`).max(PASSWORD_MAX_LENGTH);
const timezone = z.string().max(80).default("America/Los_Angeles").refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}, "Choose a valid timezone.");
export const signupSchema = z.object({ name, password: newPassword, farmName: z.string().trim().min(1).max(120), timezone, client }).strict();
export const loginSchema = z.object({ name, password, client }).strict();
export const joinSchema = z.object({ name, password: newPassword, code: z.string().trim().regex(/^[A-Za-z0-9]{12}$/).transform(value => value.toUpperCase()), client }).strict();
export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  return parseOrThrow(schema, value, "Check the entered details.");
}
