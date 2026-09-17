import path from "node:path";
import { config as loadDotenv } from "dotenv";

const projectRoot = path.resolve(__dirname, "../../..");

// Load the same local files Next.js reads for development. Real environment variables win.
loadDotenv({ path: [path.join(projectRoot, ".env.local"), path.join(projectRoot, ".env")], quiet: true });

// The runtime URLs as configured when the process started. Route tests later point
// process.env.DATABASE_URL at the test database; the guard must keep comparing against the
// original runtime targets, not the mutated value.
const ORIGINAL_RUNTIME_URLS = {
  DATABASE_URL: process.env.DATABASE_URL?.trim() || undefined,
  DATABASE_MIGRATION_URL: process.env.DATABASE_MIGRATION_URL?.trim() || undefined,
} as const;

export type TestDatabaseTarget = {
  /** Owner connection to the disposable test database (DDL allowed). */
  url: string;
  /** Optional restricted-role connection to the same test database, for grant checks. */
  appUrl: string | null;
};

function describeTarget(url: string): { host: string; port: string; database: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port || "5432",
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
  };
}

function sameDatabase(a: string, b: string): boolean {
  try {
    const x = describeTarget(a);
    const y = describeTarget(b);
    return x.host === y.host && x.port === y.port && x.database === y.database;
  } catch {
    return a === b;
  }
}

/**
 * Resolves the isolated test database and refuses anything that could touch the runtime
 * database. Every integration test and cleanup helper must go through this function.
 */
export function getTestDatabaseTarget(): TestDatabaseTarget {
  const url = process.env.TEST_DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Backend integration tests need a separate disposable database; see docs/backend/setup.md.",
    );
  }

  const { database } = describeTarget(url);
  if (!/test/i.test(database)) {
    throw new Error(
      `Refusing to run integration tests: TEST_DATABASE_URL database "${database}" does not contain "test".`,
    );
  }

  for (const key of ["DATABASE_URL", "DATABASE_MIGRATION_URL"] as const) {
    const other = ORIGINAL_RUNTIME_URLS[key];
    if (other && sameDatabase(other, url)) {
      throw new Error(`Refusing to run integration tests: TEST_DATABASE_URL points at the same database as ${key}.`);
    }
  }

  const appUrl = process.env.TEST_DATABASE_APP_URL?.trim() || null;
  if (appUrl && !sameDatabase(appUrl, url)) {
    throw new Error("TEST_DATABASE_APP_URL must point at the same database as TEST_DATABASE_URL.");
  }

  return { url, appUrl };
}

/** Whether an isolated test database is configured; used to skip DB suites with a clear message. */
export function hasTestDatabase(): boolean {
  try {
    getTestDatabaseTarget();
    return true;
  } catch {
    return false;
  }
}
