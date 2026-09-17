/**
 * Puts the Bays Ranch sample farm back to its original seeded state. Everything that belongs
 * to the farm is deleted (logs, tags, recordings, accounts and their sessions, workspace
 * pages, messages) and the initial dataset is loaded again. Other farms are not touched.
 */
import type postgres from "postgres";
import { FARM } from "./initial-data";
import { seedInitialData, type SeedReport } from "./seed";

export async function resetSampleFarm(client: postgres.Sql): Promise<SeedReport> {
  await client.begin(async (tx) => {
    const farm = FARM.id;
    await tx`delete from toph.account_sessions where account_id in (select id from toph.accounts where farm_id = ${farm})`;
    await tx`delete from toph.mobile_recordings where farm_id = ${farm}`;
    await tx`delete from toph.mobile_submissions where farm_id = ${farm}`;
    await tx`delete from toph.mobile_profiles where farm_id = ${farm}`;
    await tx`delete from toph.work_log_tags where farm_id = ${farm}`;
    await tx`delete from toph.work_logs where farm_id = ${farm}`;
    await tx`delete from toph.tags where farm_id = ${farm}`;
    await tx`delete from toph.accounts where farm_id = ${farm}`;
    await tx`delete from toph.fields where farm_id = ${farm}`;
    await tx`delete from toph.employees where farm_id = ${farm}`;
    await tx`delete from toph.workspace_state where farm_id = ${farm}`;
    await tx`delete from toph.transcription_usage where farm_id = ${farm}`;
    await tx`delete from toph.farm_images where farm_id = ${farm}`;
    await tx`delete from toph.farm_access where farm_id = ${farm}`;
    await tx`update toph.farms set name = ${FARM.name}, avatar_path = ${FARM.avatarPath}, timezone = ${FARM.timezone} where id = ${farm}`;
  });
  return seedInitialData(client);
}
