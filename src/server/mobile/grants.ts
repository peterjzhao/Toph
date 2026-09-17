/** Explicit operator opt-in. The existing web deployment's grants remain unchanged. */
import type postgres from "postgres";
import { RUNTIME_ROLE_PATTERN } from "@/server/db/grants";
export async function applyMobileGrants(sql: postgres.Sql, role: string) {
  if (!RUNTIME_ROLE_PATTERN.test(role)) throw new Error("Invalid runtime role.");
  await sql.begin(async tx => {
    await tx`grant select, insert on toph.mobile_profiles, toph.mobile_recordings, toph.mobile_submissions to ${tx(role)}`;
    await tx`grant update (avatar_url, default_field, default_activity) on toph.mobile_profiles to ${tx(role)}`;
    await tx`grant insert on toph.work_logs, toph.employees to ${tx(role)}`;
    await tx`grant update (display_name, avatar_path, updated_at) on toph.employees to ${tx(role)}`;
  });
}
