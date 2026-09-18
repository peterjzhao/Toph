import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { runMigrations } from "@/server/db/migrate";
import { seedInitialData } from "@/server/db/seed";
import { FARM_ID } from "@/server/db/initial-data";
import { getTestDatabaseTarget } from "./test-env";

/**
 * A second, test-only farm used to prove that everything is scoped to the configured farm:
 * its records must be invisible and immutable through the API.
 */
export const OTHER_FARM = {
  id: "00000000-0000-4000-8000-000000000002",
  employeeId: "10000000-0000-4000-8000-000000000999",
  fieldId: "20000000-0000-4000-8000-000000000999",
  logId: "30000000-0000-4000-8000-000000000999",
  tagId: "50000000-0000-4000-8000-000000000999",
} as const;

/** Migrates and seeds the isolated test database; idempotent, safe to call from every suite. */
export async function prepareTestDatabase(sql: postgres.Sql): Promise<void> {
  await runMigrations(getTestDatabaseTarget().url);
  await seedInitialData(sql);
  await seedOtherFarm(sql);
}

export async function seedOtherFarm(sql: postgres.Sql): Promise<void> {
  await sql`insert into toph.farms (id, name, timezone)
    values (${OTHER_FARM.id}, 'Other Orchard', 'America/Chicago')
    on conflict (id) do nothing`;
  await sql`insert into toph.employees (id, farm_id, display_name)
    values (${OTHER_FARM.employeeId}, ${OTHER_FARM.id}, 'Other Worker') on conflict (id) do nothing`;
  await sql`insert into toph.fields (id, farm_id, name)
    values (${OTHER_FARM.fieldId}, ${OTHER_FARM.id}, 'ORCHARD 1') on conflict (id) do nothing`;
  await sql`insert into toph.work_logs (id, farm_id, employee_id, field_id, activity, work_date, start_at, end_at, summary, is_new)
    values (${OTHER_FARM.logId}, ${OTHER_FARM.id}, ${OTHER_FARM.employeeId}, ${OTHER_FARM.fieldId}, 'Spraying', '2026-04-19',
            '2026-04-19T13:00:00Z', '2026-04-19T15:00:00Z', 'Other farm summary.', true)
    on conflict (id) do nothing`;
  await sql`insert into toph.tags (id, farm_id, label, normalized_label)
    values (${OTHER_FARM.tagId}, ${OTHER_FARM.id}, 'Other tag', 'other tag') on conflict (id) do nothing`;
  await sql`insert into toph.work_log_tags (farm_id, work_log_id, tag_id)
    values (${OTHER_FARM.id}, ${OTHER_FARM.logId}, ${OTHER_FARM.tagId}) on conflict do nothing`;
}

/** Removes every tag and association of the primary farm in the TEST database only. */
export async function resetTags(sql: postgres.Sql): Promise<void> {
  getTestDatabaseTarget();
  await sql`delete from toph.work_log_tags where farm_id = ${FARM_ID}`;
  await sql`delete from toph.tags where farm_id = ${FARM_ID}`;
}

export function uniqueLabel(prefix = "Tag"): string {
  return `${prefix} ${randomUUID().slice(0, 8)}`;
}
