/**
 * Loads the Bays Ranch initial dataset. Idempotent: inserts the records that are missing and
 * leaves everything else untouched, including edits and user-added tags. Never runs at
 * application startup.
 */
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { FARM, FIELD_MAP_PATH, INITIAL_EMPLOYEES, INITIAL_ROWS, RECORDING, recordId } from "./initial-data";
import * as schema from "./schema";
import { instantToLocalDate, localDateTimeToInstant } from "@/server/time/zoned";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { makeWorkspaceSeed } from "@/server/workspace/seed";

/** The Figma admin photo, stored in the farm's workspace settings like an uploaded photo. */
function sampleAdminAvatar(): string {
  const file = fileURLToPath(new URL("../../../public/assets/avatar.jpg", import.meta.url));
  return `data:image/jpeg;base64,${readFileSync(file).toString("base64")}`;
}

export type SeedCounts = { inserted: number; existing: number };

export type SeedReport = {
  farm: "inserted" | "existing";
  employees: SeedCounts;
  fields: SeedCounts;
  workLogs: SeedCounts;
};

function counts(total: number, inserted: number): SeedCounts {
  return { inserted, existing: total - inserted };
}

/** Builds the work-log rows with farm-local times converted to unambiguous instants. */
export function buildInitialWorkLogs(): (typeof schema.workLogs.$inferInsert)[] {
  return INITIAL_ROWS.map((row) => {
    const startAt = localDateTimeToInstant(row.workDate, row.start, FARM.timezone);
    const endAt = localDateTimeToInstant(row.workDate, row.end, FARM.timezone);
    if (instantToLocalDate(startAt, FARM.timezone) !== row.workDate) {
      throw new Error(`Row ${row.n}: work_date ${row.workDate} does not match its start time`);
    }
    if (endAt <= startAt) throw new Error(`Row ${row.n}: end time is not after start time`);

    return {
      id: recordId("workLog", row.n),
      farmId: FARM.id,
      employeeId: recordId("employee", row.n),
      fieldId: recordId("field", row.n),
      activity: row.activity,
      workDate: row.workDate,
      startAt,
      endAt,
      summary: row.summary,
      transcript: null,
      isNew: row.isNew,
      recordingPath: RECORDING.path,
      recordingDurationSeconds: RECORDING.durationSeconds,
      waveformAssetPath: RECORDING.waveformAssetPath,
      waveformPeaks: null,
    };
  });
}

export async function seedInitialData(client: postgres.Sql): Promise<SeedReport> {
  const db = drizzle(client, { schema });

  return db.transaction(async (tx) => {
    const [existingFarm] = await tx.select({ id: schema.farms.id }).from(schema.farms).where(eq(schema.farms.id, FARM.id));
    await tx
      .insert(schema.farms)
      .values({ id: FARM.id, name: FARM.name, avatarPath: FARM.avatarPath, timezone: FARM.timezone })
      .onConflictDoNothing({ target: schema.farms.id });

    const employeeValues = INITIAL_EMPLOYEES.map((row) => ({
      id: recordId("employee", row.n),
      farmId: FARM.id,
      displayName: row.name,
      isActive: true,
    }));
    const employeeRows = await tx
      .insert(schema.employees)
      .values(employeeValues)
      .onConflictDoNothing({ target: schema.employees.id })
      .returning({ id: schema.employees.id });

    const fieldValues = INITIAL_ROWS.map((row) => ({
      id: recordId("field", row.n),
      farmId: FARM.id,
      name: row.field,
      mapImagePath: FIELD_MAP_PATH,
    }));
    const fieldRows = await tx
      .insert(schema.fields)
      .values(fieldValues)
      .onConflictDoNothing({ target: schema.fields.id })
      .returning({ id: schema.fields.id });

    const logValues = buildInitialWorkLogs();
    const logRows = await tx
      .insert(schema.workLogs)
      .values(logValues)
      .onConflictDoNothing({ target: schema.workLogs.id })
      .returning({ id: schema.workLogs.id });

    // Explicit sample identities; this does not change any original employee or log.
    await tx.insert(schema.farmAccess).values({ farmId: FARM.id, joinCode: randomBytes(6).toString("hex").toUpperCase(), isSample: true, setupComplete: true }).onConflictDoNothing({ target: schema.farmAccess.farmId });
    await tx.insert(schema.accounts).values([
      { id: "90000000-0000-4000-8000-000000000001", farmId: FARM.id, employeeId: null, name: "Ranch Admin", normalizedName: "ranch admin", role: "admin" as const },
      ...INITIAL_EMPLOYEES.map(row => ({ id: recordId("employee", row.n), farmId: FARM.id, employeeId: recordId("employee", row.n), name: row.name, normalizedName: row.name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase(), role: "worker" as const })),
    ]).onConflictDoNothing({ target: schema.accounts.id });

    // The workspace a first dashboard read would create, plus the admin's Figma photo.
    const seededEmployees = await tx.select({ id: schema.employees.id, display_name: schema.employees.displayName, is_active: schema.employees.isActive })
      .from(schema.employees).where(eq(schema.employees.farmId, FARM.id)).orderBy(schema.employees.id);
    const seededFields = await tx.select({ id: schema.fields.id, name: schema.fields.name })
      .from(schema.fields).where(eq(schema.fields.farmId, FARM.id)).orderBy(schema.fields.id);
    const workspace = makeWorkspaceSeed({ id: FARM.id, name: FARM.name, timezone: FARM.timezone, avatarPath: FARM.avatarPath }, seededEmployees, seededFields);
    workspace.settings.adminAvatar = sampleAdminAvatar();
    await tx.execute(sql`insert into toph.workspace_state (farm_id, payload, revision)
      values (${FARM.id}, ${JSON.stringify(workspace)}::jsonb, 0) on conflict (farm_id) do nothing`);

    return {
      farm: existingFarm ? "existing" : "inserted",
      employees: counts(employeeValues.length, employeeRows.length),
      fields: counts(fieldValues.length, fieldRows.length),
      workLogs: counts(logValues.length, logRows.length),
    };
  });
}
