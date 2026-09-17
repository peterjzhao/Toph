import { FARM_ID } from "@/server/db/initial-data";
import { getTestDatabaseTarget } from "./test-env";

export const TEST_APP_ORIGIN = "http://127.0.0.1:3000";

const KEYS = ["DATABASE_URL", "TOPH_FARM_ID", "APP_ORIGIN"] as const;

type Snapshot = Record<(typeof KEYS)[number], string | undefined>;

/**
 * Points the route handlers' runtime configuration at the isolated TEST database for the
 * current test process only. Returns a restore function for afterAll.
 */
export function useRouteTestEnv(overrides: Partial<Snapshot> = {}): () => void {
  const snapshot = Object.fromEntries(KEYS.map((k) => [k, process.env[k]])) as Snapshot;
  const target = getTestDatabaseTarget();
  const values: Snapshot = {
    DATABASE_URL: target.url,
    TOPH_FARM_ID: FARM_ID,
    APP_ORIGIN: TEST_APP_ORIGIN,
    ...overrides,
  };
  applyEnv(values);
  return () => applyEnv(snapshot);
}

export function applyEnv(values: Partial<Snapshot>): void {
  for (const key of KEYS) {
    if (!(key in values)) continue;
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
