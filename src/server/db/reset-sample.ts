/**
 * Restores the Bays Ranch Figma dataset while retaining confirmed field labels, boundaries,
 * IDs and the shared aerial image. Other farms are not touched. An explicit option replaces
 * the stored map with the committed reviewed map too; the safe default preserves it. The
 * reset is one transaction.
 */
import type postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { FARM } from "./initial-data";
import { seedInitialDataRows, type SeedReport } from "./seed";
import * as schema from "./schema";

export async function resetSampleFarm(client: postgres.Sql, options: { preserveFields?: boolean } = {}): Promise<SeedReport> {
  const preserveFields = options.preserveFields !== false;
  return drizzle(client, { schema }).transaction(async (tx) => {
    const farm = FARM.id;
    await tx.execute(sql`select farm_id from toph.farm_access where farm_id = ${farm} for update`);
    await tx.execute(sql`delete from toph.account_sessions where account_id in (select id from toph.accounts where farm_id = ${farm})`);
    await tx.execute(sql`delete from toph.mobile_recordings where farm_id = ${farm}`);
    await tx.execute(sql`delete from toph.mobile_submissions where farm_id = ${farm}`);
    await tx.execute(sql`delete from toph.mobile_profiles where farm_id = ${farm}`);
    await tx.execute(sql`delete from toph.work_log_tags where farm_id = ${farm}`);
    await tx.execute(sql`delete from toph.work_logs where farm_id = ${farm}`);
    await tx.execute(sql`delete from toph.tags where farm_id = ${farm}`);
    await tx.execute(sql`delete from toph.accounts where farm_id = ${farm}`);
    if (!preserveFields) {
      await tx.execute(sql`delete from toph.fields where farm_id = ${farm}`);
      await tx.execute(sql`delete from toph.farm_images where farm_id = ${farm}`);
    }
    await tx.execute(sql`delete from toph.employees where farm_id = ${farm}`);
    await tx.execute(sql`delete from toph.workspace_state where farm_id = ${farm}`);
    await tx.execute(sql`delete from toph.farm_reports where farm_id = ${farm}`);
    await tx.execute(sql`delete from toph.transcription_usage where farm_id = ${farm}`);
    await tx.execute(sql`delete from toph.farm_access where farm_id = ${farm}`);
    await tx.execute(sql`update toph.farms set name = ${FARM.name}, avatar_path = ${FARM.avatarPath}, timezone = ${FARM.timezone} where id = ${farm}`);
    return seedInitialDataRows(tx);
  });
}
