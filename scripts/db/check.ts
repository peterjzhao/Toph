/**
 * Read-only health check for a configured database: connectivity, migration state, seed
 * state, and (when DATABASE_URL uses a separate role) the runtime role's effective privileges.
 * Prints no secrets. Exit code 1 when something needed by the app is missing.
 *
 *   npm run db:check
 */
import type postgres from "postgres";
import { createSqlClient } from "@/server/db/connection";
import { FARM_ID } from "@/server/db/initial-data";
import { describeRuntimeGrants } from "@/server/db/grants";
import { describeUrl, loadLocalEnv } from "./lib/env";

let failures = 0;

function report(ok: boolean, message: string): void {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${message}`);
}

async function checkSchemaAndSeed(sql: postgres.Sql, label: string): Promise<void> {
  const [{ version }] = await sql<{ version: string }[]>`select current_setting('server_version') as version`;
  report(true, `${label}: connected (PostgreSQL ${version})`);

  const [{ exists }] = await sql<{ exists: boolean }[]>`select to_regclass('toph.dashboard_logs') is not null as exists`;
  report(exists, `${label}: toph schema and dashboard_logs view exist${exists ? "" : " (run npm run db:migrate)"}`);
  if (!exists) return;

  if ((process.env.TOPH_MOBILE_ENABLED ?? process.env.TOPH_MOBILE_DEMO_ENABLED) === "true") {
    const [{ mobile_tables }] = await sql<{ mobile_tables: boolean }[]>`
      select to_regclass('toph.mobile_profiles') is not null
         and to_regclass('toph.mobile_submissions') is not null
         and to_regclass('toph.mobile_recordings') is not null
         and to_regclass('toph.transcription_usage') is not null as mobile_tables`;
    report(mobile_tables, `${label}: mobile tables exist${mobile_tables ? "" : " (run npm run db:migrate)"}`);
  }

  const farmId = process.env.TOPH_FARM_ID?.trim() || FARM_ID;
  const [farm] = await sql<{ name: string }[]>`select name from toph.farms where id = ${farmId}`;
  report(Boolean(farm), `${label}: configured farm exists${farm ? ` (${farm.name})` : " (run npm run db:seed or fix TOPH_FARM_ID)"}`);

  const [counts] = await sql<{ logs: number; employees: number; tags: number; links: number }[]>`
    select (select count(*)::int from toph.work_logs where farm_id = ${farmId}) as logs,
           (select count(*)::int from toph.employees where farm_id = ${farmId}) as employees,
           (select count(*)::int from toph.tags where farm_id = ${farmId}) as tags,
           (select count(*)::int from toph.work_log_tags where farm_id = ${farmId}) as links`;
  report(counts.logs > 0, `${label}: ${counts.logs} work log(s), ${counts.employees} employee(s)`);
  console.log(`      ${label}: ${counts.tags} tag(s) in catalog, ${counts.links} tag association(s)`);
}

async function checkRuntimePrivileges(sql: postgres.Sql): Promise<void> {
  const mobileEnabled = (process.env.TOPH_MOBILE_ENABLED ?? process.env.TOPH_MOBILE_DEMO_ENABLED) === "true";
  const [{ user }] = await sql<{ user: string }[]>`select current_user as user`;
  const [p] = await sql<Record<string, boolean>[]>`
    select has_schema_privilege('toph', 'USAGE') as schema_usage,
           has_table_privilege('toph.dashboard_logs', 'SELECT') as view_select,
           has_table_privilege('toph.tags', 'INSERT') as tags_insert,
           has_table_privilege('toph.work_log_tags', 'INSERT') as links_insert,
           has_table_privilege('toph.work_log_tags', 'DELETE') as links_delete,
           has_column_privilege('toph.work_logs', 'updated_at', 'UPDATE') as updated_at_update,
           has_table_privilege('toph.work_logs', 'INSERT') as logs_insert,
           has_table_privilege('toph.work_logs', 'DELETE') as logs_delete,
           has_table_privilege('toph.tags', 'DELETE') as tags_delete,
           has_column_privilege('toph.work_logs', 'summary', 'UPDATE') as summary_update`;
  report(p.schema_usage && p.view_select, `runtime role ${user}: can read the toph schema`);
  report(p.tags_insert && p.links_insert && p.links_delete && p.updated_at_update, `runtime role ${user}: has the tag write path`);
  const restricted = !p.logs_delete && !p.tags_delete && !p.summary_update && (mobileEnabled || !p.logs_insert);
  report(restricted, `runtime role ${user}: cannot rewrite/delete logs or delete tags${restricted ? "" : " (role is broader than intended)"}`);

  if (mobileEnabled) {
    const [mobile] = await sql<Record<string, boolean>[]>`
      select has_table_privilege('toph.employees', 'INSERT') as employees_insert,
             has_column_privilege('toph.employees', 'display_name', 'UPDATE') as employee_name_update,
             has_column_privilege('toph.employees', 'avatar_path', 'UPDATE') as employee_avatar_update,
             has_column_privilege('toph.employees', 'farm_id', 'UPDATE') as employee_farm_update,
             has_table_privilege('toph.employees', 'DELETE') as employees_delete,
             has_table_privilege('toph.mobile_profiles', 'SELECT') as profiles_select,
             has_table_privilege('toph.mobile_profiles', 'INSERT') as profiles_insert,
             has_column_privilege('toph.mobile_profiles', 'avatar_url', 'UPDATE') as profile_avatar_update,
             has_column_privilege('toph.mobile_profiles', 'default_field', 'UPDATE') as profile_field_update,
             has_column_privilege('toph.mobile_profiles', 'default_activity', 'UPDATE') as profile_activity_update,
             has_column_privilege('toph.mobile_profiles', 'employee_id', 'UPDATE') as profile_identity_update,
             has_table_privilege('toph.mobile_profiles', 'DELETE') as profiles_delete,
             has_table_privilege('toph.mobile_recordings', 'INSERT') as recordings_insert,
             has_table_privilege('toph.mobile_recordings', 'UPDATE, DELETE') as recordings_mutate,
             has_table_privilege('toph.mobile_submissions', 'INSERT') as submissions_insert,
             has_table_privilege('toph.mobile_submissions', 'UPDATE, DELETE') as submissions_mutate,
             has_table_privilege('toph.transcription_usage', 'INSERT') as quota_insert,
             has_column_privilege('toph.transcription_usage', 'minute_count', 'UPDATE') as quota_minute_update,
             has_column_privilege('toph.transcription_usage', 'day_count', 'UPDATE') as quota_day_update,
             has_column_privilege('toph.transcription_usage', 'farm_id', 'UPDATE') as quota_farm_update,
             has_table_privilege('toph.transcription_usage', 'DELETE') as quota_delete`;
    report(p.logs_insert && mobile.employees_insert && mobile.employee_name_update && mobile.employee_avatar_update
      && mobile.profiles_select && mobile.profiles_insert && mobile.profile_avatar_update && mobile.profile_field_update && mobile.profile_activity_update
      && mobile.recordings_insert && mobile.submissions_insert && mobile.quota_insert && mobile.quota_minute_update && mobile.quota_day_update,
    `runtime role ${user}: has the mobile save/profile path (npm run db:enable-mobile)`);
    report(!mobile.employee_farm_update && !mobile.employees_delete && !mobile.profile_identity_update
      && !mobile.profiles_delete && !mobile.recordings_mutate && !mobile.submissions_mutate && !mobile.quota_farm_update && !mobile.quota_delete,
    `runtime role ${user}: cannot reassign accounts or rewrite/delete saved mobile media and receipts`);
  }
}

async function main(): Promise<void> {
  loadLocalEnv();
  const runtimeUrl = process.env.DATABASE_URL?.trim();
  const migrationUrl = process.env.DATABASE_MIGRATION_URL?.trim();
  const sslCaPath = process.env.DATABASE_SSL_CA_PATH?.trim() || null;
  const role = process.env.DATABASE_APP_ROLE?.trim();

  if (!runtimeUrl && !migrationUrl) {
    report(false, "Neither DATABASE_URL nor DATABASE_MIGRATION_URL is set (see .env.example)");
    process.exit(1);
  }

  if (migrationUrl) {
    const sql = createSqlClient(migrationUrl, { max: 1, sslCaPath, applicationName: "toph-check" });
    try {
      await checkSchemaAndSeed(sql, `migration connection ${describeUrl(migrationUrl)}`);
      const [{ count }] = await sql<{ count: number }[]>`
        select coalesce((select count(*)::int from drizzle.__drizzle_migrations), 0) as count`.catch(() => [{ count: 0 }]);
      report(count > 0, `migration connection: ${count} migration(s) recorded in drizzle.__drizzle_migrations`);
    } catch (error) {
      report(false, `migration connection ${describeUrl(migrationUrl)}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await sql.end();
    }
  } else {
    console.log("INFO  DATABASE_MIGRATION_URL not set; skipping migration/seed inspection.");
  }

  if (runtimeUrl) {
    const sql = createSqlClient(runtimeUrl, { max: 1, sslCaPath, applicationName: "toph-check" });
    try {
      await checkSchemaAndSeed(sql, `runtime connection ${describeUrl(runtimeUrl)}`);
      await checkRuntimePrivileges(sql);
    } catch (error) {
      report(false, `runtime connection ${describeUrl(runtimeUrl)}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await sql.end();
    }
  } else {
    report(false, "DATABASE_URL is not set; the app will answer 503 for database-backed routes");
  }

  if (role) {
    console.log(`INFO  Expected grants for ${role}:`);
    for (const line of describeRuntimeGrants(role)) console.log(`      ${line}`);
    if ((process.env.TOPH_MOBILE_ENABLED ?? process.env.TOPH_MOBILE_DEMO_ENABLED) === "true") {
      console.log("      Mobile enabled: additional log/media inserts and employee/profile column updates.");
    }
  }

  console.log(failures === 0 ? "All checks passed." : `${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`Check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
