import "server-only";
/**
 * Trusted farm context.
 *
 * Every service call receives a FarmContext whose farm was resolved on the server from
 * configuration (TOPH_FARM_ID) and verified in the database. Request input never selects the
 * farm. This deployment serves one farm; per-user authorization is a later concern.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { getRuntimeDatabase, type Database } from "@/server/db/client";
import { createSqlClient } from "@/server/db/connection";
import { mapDatabaseError } from "@/server/db/errors";
import * as schema from "@/server/db/schema";
import { notConfigured } from "@/server/errors";
import { isUuid } from "@/server/validation/ids";

export type Farm = {
  id: string;
  name: string;
  avatarPath: string | null;
  timezone: string;
};

export type FarmContext = {
  readonly db: Database;
  readonly sql: postgres.Sql;
  readonly farmId: string;
  readonly farm: Farm;
  /** Releases resources owned by this context; a no-op for the shared runtime pool. */
  close(): Promise<void>;
};

export type RuntimeConfig = {
  farmId: string | null;
  appOrigin: string | null;
};

export function readRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    farmId: env.TOPH_FARM_ID?.trim() || null,
    appOrigin: env.APP_ORIGIN?.trim() || null,
  };
}

async function loadFarm(db: Database, farmId: string): Promise<Farm> {
  let rows: Farm[];
  try {
    rows = await db
      .select({
        id: schema.farms.id,
        name: schema.farms.name,
        avatarPath: schema.farms.avatarPath,
        timezone: schema.farms.timezone,
      })
      .from(schema.farms)
      .where(eq(schema.farms.id, farmId));
  } catch (error) {
    throw mapDatabaseError(error) ?? error;
  }
  const farm = rows[0];
  if (!farm) throw notConfigured("The configured farm does not exist in the database.");
  return farm;
}

/**
 * Resolves the farm context for an HTTP request from server configuration and the shared
 * runtime pool. Throws 503 ApiErrors when the database, the farm setting, or the farm row is
 * missing.
 */
export async function resolveFarmContext(): Promise<FarmContext> {
  const config = readRuntimeConfig();
  if (!config.farmId || !isUuid(config.farmId)) throw notConfigured("The farm is not configured.");

  const { db, sql } = getRuntimeDatabase();
  const farmId = config.farmId.toLowerCase();
  const farm = await loadFarm(db, farmId);
  return { db, sql, farmId, farm, close: async () => undefined };
}

export type CreateFarmContextOptions = {
  databaseUrl: string;
  farmId: string;
  sslCaPath?: string | null;
  poolMax?: number;
};

/** Builds a context with its own dedicated client (tests, scripts, isolated processes). Call `close()` when done. */
export async function createFarmContext(options: CreateFarmContextOptions): Promise<FarmContext> {
  if (!isUuid(options.farmId)) throw notConfigured("The farm ID must be a UUID.");
  const farmId = options.farmId.toLowerCase();
  const sql = createSqlClient(options.databaseUrl, {
    max: options.poolMax ?? 5,
    sslCaPath: options.sslCaPath ?? null,
    applicationName: "toph-context",
  });
  const db = drizzle(sql, { schema });
  try {
    const farm = await loadFarm(db, farmId);
    return { db, sql, farmId, farm, close: () => sql.end({ timeout: 5 }) };
  } catch (error) {
    await sql.end({ timeout: 5 }).catch(() => undefined);
    throw error;
  }
}
