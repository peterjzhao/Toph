/**
 * Maps driver and PostgreSQL failures to sanitized ApiErrors. Anything not recognized here is
 * left for the route layer to report as a generic 500; raw driver messages never reach clients.
 */
import { ApiError, databaseUnavailable } from "@/server/errors";

const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "CONNECTION_ENDED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
]);

// SQLSTATE classes/codes that mean the database itself is unavailable or not prepared.
const UNAVAILABLE_SQLSTATE_PREFIXES = ["08", "28", "3D", "53", "57"];
const SCHEMA_MISSING_SQLSTATES = new Set(["42P01", "3F000"]);
const PRIVILEGE_SQLSTATE = "42501";

function codeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** Drizzle wraps driver failures in a query error; the driver code lives on `cause`. */
function* causeChain(error: unknown): Generator<unknown> {
  let current = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    yield current;
    current = (current as { cause?: unknown }).cause;
  }
}

/** Returns a sanitized 503 for connectivity, authentication, or missing-schema failures; otherwise null. */
export function mapDatabaseError(error: unknown): ApiError | null {
  for (const candidate of causeChain(error)) {
    if (candidate instanceof ApiError) return candidate;
    if (candidate instanceof AggregateError && candidate.errors.some((e) => NETWORK_CODES.has(codeOf(e) ?? ""))) {
      return databaseUnavailable();
    }
    const code = codeOf(candidate);
    if (!code) continue;
    if (NETWORK_CODES.has(code)) return databaseUnavailable();
    if (SCHEMA_MISSING_SQLSTATES.has(code)) return databaseUnavailable("The database schema has not been migrated.");
    if (code === PRIVILEGE_SQLSTATE) return databaseUnavailable("The database role lacks a required privilege.");
    if (UNAVAILABLE_SQLSTATE_PREFIXES.some((prefix) => code.startsWith(prefix))) return databaseUnavailable();
  }
  return null;
}

/** Removes anything that looks like a connection string before an error is logged. */
export function redactConnectionStrings(text: string): string {
  return text.replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, "postgresql://[redacted]");
}
