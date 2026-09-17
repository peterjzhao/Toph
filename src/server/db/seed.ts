/**
 * Loads the Bays Ranch initial dataset. Idempotent: inserts the records that are missing and
 * leaves everything else untouched, including edits and user-added tags. Never runs at
 * application startup.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { FARM, FIELD_MAP_PATH, INITIAL_EMPLOYEES, INITIAL_ROWS, RECORDING, recordId } from "./initial-data";
import * as schema from "./schema";
import { instantToLocalDate, localDateTimeToInstant } from "@/server/time/zoned";

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

    return {
      farm: existingFarm ? "existing" : "inserted",
      employees: counts(employeeValues.length, employeeRows.length),
      fields: counts(fieldValues.length, fieldRows.length),
      workLogs: counts(logValues.length, logRows.length),
    };
  });
}
