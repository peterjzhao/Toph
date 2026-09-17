/**
 * postgres.js client factory shared by the app runtime, migration/seed scripts, and tests.
 * It never reads environment variables itself; callers pass the URL they are entitled to use.
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

export type SqlClientOptions = {
  /** Upper bound on pooled connections for this client. */
  max?: number;
  /** Optional PEM bundle used to verify a hosted database certificate. */
  sslCaPath?: string | null;
  applicationName?: string;
  idleTimeoutSeconds?: number;
  connectTimeoutSeconds?: number;
};

export type ResolvedSsl = false | { rejectUnauthorized: true; ca?: string };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Loopback connections use no TLS unless the URL asks for it. Every other host uses TLS with
 * certificate verification. Note that postgres.js maps `sslmode=require` to
 * `rejectUnauthorized: false`; this function always passes an explicit object instead so a
 * URL parameter can never silently disable verification.
 */
export function resolveSslOption(url: string, sslCaPath?: string | null): ResolvedSsl {
  const parsed = new URL(url);
  const mode = parsed.searchParams.get("sslmode");
  const loopback = LOOPBACK_HOSTS.has(parsed.hostname);
  if (mode === "disable" && !loopback) {
    throw new Error("TLS cannot be disabled for a remote database.");
  }
  if (loopback && (!mode || mode === "disable")) return false;
  const ssl: { rejectUnauthorized: true; ca?: string } = { rejectUnauthorized: true };
  if (sslCaPath) ssl.ca = readFileSync(sslCaPath, "utf8");
  return ssl;
}

export function createSqlClient(url: string, options: SqlClientOptions = {}): postgres.Sql {
  return postgres(url, {
    max: options.max ?? 5,
    // Prepared statements are not supported by Supabase's transaction pooler; they stay off
    // everywhere so one configuration works for direct and pooled connections.
    prepare: false,
    ssl: resolveSslOption(url, options.sslCaPath),
    idle_timeout: options.idleTimeoutSeconds ?? 30,
    connect_timeout: options.connectTimeoutSeconds ?? 10,
    max_lifetime: 60 * 30,
    connection: { application_name: options.applicationName ?? "toph" },
    onnotice: () => {},
  });
}
