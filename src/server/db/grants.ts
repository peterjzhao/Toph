/**
 * Privileges for the restricted runtime database role (DATABASE_URL).
 *
 * The runtime role can read the private schema, perform the tag write path, and save workspace
 * state: insert tags, insert/delete tag associations, update work_logs.updated_at, and
 * insert/update workspace payload/revision. DDL, reference
 * changes, and deletions of anything else stay with the owner/migration role. PUBLIC and the
 * Supabase API roles (anon, authenticated, service_role), when present, get nothing.
 *
 * Applied by `npm run db:migrate` after migrations, using the migration connection.
 */
import type postgres from "postgres";

export const RUNTIME_ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

const SUPABASE_API_ROLES = ["anon", "authenticated", "service_role"] as const;

export type GrantResult = { applied: boolean; role: string; reason?: string; revokedFrom: string[] };

/** Human-readable list of what the runtime role receives; used by docs and `npm run db:check`. */
export function describeRuntimeGrants(role: string): string[] {
  return [
    `GRANT USAGE ON SCHEMA toph TO ${role}`,
    `GRANT SELECT ON ALL TABLES IN SCHEMA toph TO ${role} (includes the dashboard_logs view)`,
    `GRANT INSERT ON toph.tags TO ${role}`,
    `GRANT INSERT, DELETE ON toph.work_log_tags TO ${role}`,
    `GRANT UPDATE (updated_at, is_new, reviewed_by, reviewed_at) ON toph.work_logs TO ${role}`,
    `GRANT INSERT and scoped column UPDATE privileges for farm/account onboarding TO ${role}`,
    `GRANT INSERT, UPDATE (payload, revision, updated_at) ON toph.workspace_state TO ${role}`,
    `GRANT EXECUTE ON FUNCTION toph.waveform_peaks_valid(jsonb) TO ${role}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA toph GRANT SELECT ON TABLES TO ${role}`,
    "REVOKE ALL ON SCHEMA toph / ALL TABLES IN SCHEMA toph FROM PUBLIC, anon, authenticated, service_role (when those roles exist)",
  ];
}

async function roleExists(sql: postgres.Sql | postgres.TransactionSql, role: string): Promise<boolean> {
  const [{ exists }] = await sql<{ exists: boolean }[]>`select exists(select 1 from pg_roles where rolname = ${role}) as exists`;
  return exists;
}

/**
 * Grants the runtime privileges to `role` and revokes access from PUBLIC and the Supabase API
 * roles. Requires a connection that owns the toph schema objects (DATABASE_MIGRATION_URL).
 * Idempotent. Returns `applied: false` when the role does not exist.
 */
export async function applyRuntimeGrants(sql: postgres.Sql, role: string): Promise<GrantResult> {
  if (!RUNTIME_ROLE_PATTERN.test(role)) {
    throw new Error(`Invalid runtime role name: ${JSON.stringify(role)}`);
  }
  if (!(await roleExists(sql, role))) {
    return { applied: false, role, reason: "role does not exist", revokedFrom: [] };
  }

  const revokedFrom: string[] = [];
  await sql.begin(async (tx) => {
    await tx`revoke all on schema toph from public`;
    await tx`revoke all on all tables in schema toph from public`;

    for (const apiRole of SUPABASE_API_ROLES) {
      if (!(await roleExists(tx, apiRole))) continue;
      await tx`revoke all on schema toph from ${tx(apiRole)}`;
      await tx`revoke all on all tables in schema toph from ${tx(apiRole)}`;
      await tx`revoke all on all functions in schema toph from ${tx(apiRole)}`;
      await tx`alter default privileges in schema toph revoke all on tables from ${tx(apiRole)}`;
      revokedFrom.push(apiRole);
    }

    await tx`grant usage on schema toph to ${tx(role)}`;
    await tx`grant select on all tables in schema toph to ${tx(role)}`;
    await tx`grant insert on toph.tags to ${tx(role)}`;
    await tx`grant insert, delete on toph.work_log_tags to ${tx(role)}`;
    await tx`grant update (updated_at, is_new, reviewed_by, reviewed_at) on toph.work_logs to ${tx(role)}`;
    await tx`grant insert on toph.farms, toph.employees, toph.accounts, toph.account_sessions, toph.farm_access, toph.farm_images, toph.fields to ${tx(role)}`;
    await tx`grant update (name, timezone, updated_at) on toph.farms to ${tx(role)}`;
    await tx`grant update (display_name, is_active, updated_at) on toph.employees to ${tx(role)}`;
    await tx`grant update (name, normalized_name, is_active) on toph.accounts to ${tx(role)}`;
    await tx`grant update (revoked_at) on toph.account_sessions to ${tx(role)}`;
    await tx`grant update (join_code, setup_complete) on toph.farm_access to ${tx(role)}`;
    await tx`grant update (mime_type, bytes, width, height, updated_at) on toph.farm_images to ${tx(role)}`;
    await tx`grant update (name, label, boundary, map_image_path, updated_at), delete on toph.fields to ${tx(role)}`;
    await tx`grant insert, update (payload, revision, updated_at) on toph.workspace_state to ${tx(role)}`;
    await tx`grant execute on function toph.waveform_peaks_valid(jsonb) to ${tx(role)}`;
    await tx`alter default privileges in schema toph grant select on tables to ${tx(role)}`;
  });

  return { applied: true, role, revokedFrom };
}
