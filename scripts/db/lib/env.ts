import path from "node:path";
import { config as loadDotenv } from "dotenv";

const projectRoot = path.resolve(__dirname, "../../..");

/** Loads .env.local then .env (same files Next.js reads locally). Real environment variables win. */
export function loadLocalEnv(): void {
  loadDotenv({ path: [path.join(projectRoot, ".env.local"), path.join(projectRoot, ".env")], quiet: true });
}

export function requireEnv(name: string, hint: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`${name} is not set. ${hint}`);
    process.exit(2);
  }
  return value;
}

/** Connection target for log lines: host, port, database, and user only; never the password. */
export function describeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "(default)";
    return `${parsed.hostname}:${parsed.port || "5432"}/${database} as ${decodeURIComponent(parsed.username) || "(default user)"}`;
  } catch {
    return "(unparseable connection string)";
  }
}

export function isLoopbackUrl(url: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}
