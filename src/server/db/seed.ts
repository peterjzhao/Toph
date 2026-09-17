/**
 * Loads the Bays Ranch initial dataset. Idempotent: inserts the records that are missing and
 * leaves everything else untouched, including edits and user-added tags. Never runs at
 * application startup.
 */
import { eq, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { BAYS_AERIAL, BAYS_FIELD_BOUNDARIES } from "./bays-field-map";
import { FARM, INITIAL_EMPLOYEES, INITIAL_ROWS, RECORDING, recordId } from "./initial-data";
import * as schema from "./schema";
import { hashPassword, initialPassword } from "@/server/accounts/password";
import { instantToLocalDate, localDateTimeToInstant } from "@/server/time/zoned";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { makeWorkspaceSeed } from "@/server/workspace/seed";

function publicAsset(path: string): Buffer {
  return readFileSync(fileURLToPath(new URL(`../../../public${path}`, import.meta.url)));
}

/** The Figma admin photo, stored in the farm's workspace settings like an uploaded photo. */
function adminAvatar(): string {
  return `data:image/jpeg;base64,${publicAsset("/assets/avatar.jpg").toString("base64")}`;
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

  return db.transaction(seedInitialDataRows);
}

/** Also used by the sample reset so removal and restoration commit together. */
export async function seedInitialDataRows(tx: Pick<PostgresJsDatabase<typeof schema>, "select" | "insert" | "execute">): Promise<SeedReport> {
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

    // The reviewed map is stored exactly as Field Setup stores any farm's confirmed fields.
    const fieldValues = INITIAL_ROWS.map((row) => {
      const label = row.field.slice(-1);
      return {
        id: recordId("field", row.n),
        farmId: FARM.id,
        name: row.field,
        label,
        boundary: BAYS_FIELD_BOUNDARIES[label].map(([x, y]) => ({ x, y })),
        mapImagePath: "/api/farm/image",
      };
    });
    await tx
      .insert(schema.farmImages)
      .values({ farmId: FARM.id, mimeType: BAYS_AERIAL.mimeType, bytes: publicAsset(BAYS_AERIAL.assetPath), width: BAYS_AERIAL.width, height: BAYS_AERIAL.height })
      .onConflictDoNothing({ target: schema.farmImages.farmId });
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

    // Accounts for the administrator and each employee; each password is the lowercased first name.
    await tx.insert(schema.farmAccess).values({ farmId: FARM.id, joinCode: randomBytes(6).toString("hex").toUpperCase(), setupComplete: true }).onConflictDoNothing({ target: schema.farmAccess.farmId });
    await tx.insert(schema.accounts).values(await Promise.all([
      { id: "90000000-0000-4000-8000-000000000001", farmId: FARM.id, employeeId: null, name: "Ranch Admin", normalizedName: "ranch admin", role: "admin" as const },
      ...INITIAL_EMPLOYEES.map(row => ({ id: recordId("employee", row.n), farmId: FARM.id, employeeId: recordId("employee", row.n), name: row.name, normalizedName: row.name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase(), role: "worker" as const })),
    ].map(async row => ({ ...row, passwordHash: await hashPassword(initialPassword(row.name)) })))).onConflictDoNothing({ target: schema.accounts.id });

    // The workspace a first dashboard read would create, plus the admin's Figma photo.
    const seededEmployees = await tx.select({ id: schema.employees.id, display_name: schema.employees.displayName, is_active: schema.employees.isActive })
      .from(schema.employees).where(eq(schema.employees.farmId, FARM.id)).orderBy(schema.employees.id);
    const seededFields = await tx.select({ id: schema.fields.id, name: schema.fields.name })
      .from(schema.fields).where(eq(schema.fields.farmId, FARM.id)).orderBy(schema.fields.id);
    const workspace = makeWorkspaceSeed({ id: FARM.id, name: FARM.name, timezone: FARM.timezone, avatarPath: FARM.avatarPath }, seededEmployees, seededFields);
    workspace.settings.adminAvatar = adminAvatar();
    await tx.execute(sql`insert into toph.workspace_state (farm_id, payload, revision)
      values (${FARM.id}, ${JSON.stringify(workspace)}::jsonb, 0) on conflict (farm_id) do nothing`);

    return {
      farm: existingFarm ? "existing" : "inserted",
      employees: counts(employeeValues.length, employeeRows.length),
      fields: counts(fieldValues.length, fieldRows.length),
      workLogs: counts(logValues.length, logRows.length),
    };
}
