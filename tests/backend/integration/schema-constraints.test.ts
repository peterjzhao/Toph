import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { runMigrations } from "@/server/db/migrate";
import { openTestSql } from "../helpers/test-db";
import { getTestDatabaseTarget } from "../helpers/test-env";

type Tx = postgres.TransactionSql;

class Rollback extends Error {}

/** Runs `fn` inside a transaction that is always rolled back, so tests leave no rows behind. */
async function withRollback(sql: postgres.Sql, fn: (tx: Tx) => Promise<void>): Promise<void> {
  await sql
    .begin(async (tx) => {
      await fn(tx);
      throw new Rollback();
    })
    .catch((error) => {
      if (!(error instanceof Rollback)) throw error;
    });
}

/** Attempts a statement in a savepoint so a failure does not abort the surrounding transaction. */
function attempt(tx: Tx, run: (sp: Tx) => Promise<unknown>): Promise<unknown> {
  return tx.savepoint((sp) => run(sp));
}

type Scratch = {
  farmA: string;
  farmB: string;
  employeeA: string;
  employeeB: string;
  fieldA: string;
  fieldB: string;
};

async function seedScratch(tx: Tx): Promise<Scratch> {
  const s: Scratch = {
    farmA: randomUUID(),
    farmB: randomUUID(),
    employeeA: randomUUID(),
    employeeB: randomUUID(),
    fieldA: randomUUID(),
    fieldB: randomUUID(),
  };
  await tx`insert into toph.farms (id, name, timezone)
    values (${s.farmA}, 'Scratch A', 'America/Los_Angeles'),
           (${s.farmB}, 'Scratch B', 'America/Los_Angeles')`;
  await tx`insert into toph.employees (id, farm_id, display_name)
    values (${s.employeeA}, ${s.farmA}, 'Worker A'), (${s.employeeB}, ${s.farmB}, 'Worker B')`;
  await tx`insert into toph.fields (id, farm_id, name)
    values (${s.fieldA}, ${s.farmA}, 'FIELD A'), (${s.fieldB}, ${s.farmB}, 'FIELD B')`;
  return s;
}

function insertLog(
  tx: Tx,
  s: Scratch,
  overrides: Partial<{
    id: string;
    farmId: string;
    employeeId: string;
    fieldId: string;
    startAt: string;
    endAt: string;
    recordingPath: string | null;
    duration: number | string | null;
  }> = {},
) {
  const id = overrides.id ?? randomUUID();
  const farmId = overrides.farmId ?? s.farmA;
  const employeeId = overrides.employeeId ?? s.employeeA;
  const fieldId = overrides.fieldId ?? s.fieldA;
  const startAt = overrides.startAt ?? "2026-04-19T13:00:00Z";
  const endAt = overrides.endAt ?? "2026-04-19T17:40:00Z";
  const recordingPath = overrides.recordingPath ?? null;
  const duration = overrides.duration ?? null;
  return tx`insert into toph.work_logs
    (id, farm_id, employee_id, field_id, activity, work_date, start_at, end_at, summary,
     recording_path, recording_duration_seconds)
    values (${id}, ${farmId}, ${employeeId}, ${fieldId}, 'Spraying', '2026-04-19', ${startAt}, ${endAt}, 'summary',
            ${recordingPath}, ${duration})
    returning id`;
}

describe("toph schema constraints", () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    await runMigrations(getTestDatabaseTarget().url);
    sql = openTestSql();
  });

  afterAll(async () => {
    await sql.end();
  });

  it("requires end_at to be after start_at", async () => {
    await withRollback(sql, async (tx) => {
      const s = await seedScratch(tx);
      await expect(
        attempt(tx, (sp) => insertLog(sp, s, { startAt: "2026-04-19T13:00:00Z", endAt: "2026-04-19T13:00:00Z" })),
      ).rejects.toThrow(/work_logs_end_after_start/);
      await expect(attempt(tx, (sp) => insertLog(sp, s))).resolves.toBeTruthy();
    });
  });

  it("rejects a work log whose employee belongs to a different farm", async () => {
    await withRollback(sql, async (tx) => {
      const s = await seedScratch(tx);
      await expect(attempt(tx, (sp) => insertLog(sp, s, { employeeId: s.employeeB }))).rejects.toThrow(
        /work_logs_employee_fk/,
      );
    });
  });

  it("rejects a work log whose field belongs to a different farm", async () => {
    await withRollback(sql, async (tx) => {
      const s = await seedScratch(tx);
      await expect(attempt(tx, (sp) => insertLog(sp, s, { fieldId: s.fieldB }))).rejects.toThrow(/work_logs_field_fk/);
    });
  });

  it("rejects associating a tag from another farm with a log", async () => {
    await withRollback(sql, async (tx) => {
      const s = await seedScratch(tx);
      const [{ id: logId }] = (await insertLog(tx, s)) as unknown as { id: string }[];
      const tagB = randomUUID();
      await tx`insert into toph.tags (id, farm_id, label, normalized_label) values (${tagB}, ${s.farmB}, 'Urgent', 'urgent')`;
      await expect(
        attempt(
          tx,
          (sp) => sp`insert into toph.work_log_tags (farm_id, work_log_id, tag_id) values (${s.farmA}, ${logId}, ${tagB})`,
        ),
      ).rejects.toThrow(/work_log_tags_tag_fk/);
      await expect(
        attempt(
          tx,
          (sp) => sp`insert into toph.work_log_tags (farm_id, work_log_id, tag_id) values (${s.farmB}, ${logId}, ${tagB})`,
        ),
      ).rejects.toThrow(/work_log_tags_work_log_fk/);
    });
  });

  it("validates tag labels: nonempty, trimmed, at most 40 characters", async () => {
    await withRollback(sql, async (tx) => {
      const s = await seedScratch(tx);
      const insert = (sp: Tx, label: string, normalized: string) =>
        sp`insert into toph.tags (id, farm_id, label, normalized_label) values (${randomUUID()}, ${s.farmA}, ${label}, ${normalized})`;
      await expect(attempt(tx, (sp) => insert(sp, "   ", ""))).rejects.toThrow(/tags_label_nonempty|tags_normalized_label_nonempty/);
      await expect(attempt(tx, (sp) => insert(sp, "a".repeat(41), "a".repeat(41)))).rejects.toThrow(/tags_label_max_length/);
      await expect(attempt(tx, (sp) => insert(sp, " padded", "padded"))).rejects.toThrow(/tags_label_trimmed/);
      await expect(attempt(tx, (sp) => insert(sp, "b".repeat(40), "b".repeat(40)))).resolves.toBeTruthy();
    });
  });

  it("keeps normalized tag labels unique per farm but reusable across farms", async () => {
    await withRollback(sql, async (tx) => {
      const s = await seedScratch(tx);
      await tx`insert into toph.tags (id, farm_id, label, normalized_label) values (${randomUUID()}, ${s.farmA}, 'Needs Review', 'needs review')`;
      await expect(
        attempt(
          tx,
          (sp) => sp`insert into toph.tags (id, farm_id, label, normalized_label) values (${randomUUID()}, ${s.farmA}, 'needs review', 'needs review')`,
        ),
      ).rejects.toThrow(/tags_farm_id_normalized_label_unique/);
      await expect(
        attempt(
          tx,
          (sp) => sp`insert into toph.tags (id, farm_id, label, normalized_label) values (${randomUUID()}, ${s.farmB}, 'Needs Review', 'needs review')`,
        ),
      ).resolves.toBeTruthy();
    });
  });

  it("validates recording duration against the recording path", async () => {
    await withRollback(sql, async (tx) => {
      const s = await seedScratch(tx);
      await expect(attempt(tx, (sp) => insertLog(sp, s, { recordingPath: null, duration: 13.38 }))).rejects.toThrow(
        /work_logs_recording_duration_valid/,
      );
      await expect(
        attempt(tx, (sp) => insertLog(sp, s, { recordingPath: "/assets/sample-recording.mp3", duration: 0 })),
      ).rejects.toThrow(/work_logs_recording_duration_valid/);
      await expect(
        attempt(tx, (sp) => insertLog(sp, s, { recordingPath: "/assets/sample-recording.mp3", duration: "Infinity" })),
      ).rejects.toThrow(/work_logs_recording_duration_valid/);
      await expect(
        attempt(tx, (sp) => insertLog(sp, s, { recordingPath: "/assets/sample-recording.mp3", duration: "NaN" })),
      ).rejects.toThrow(/work_logs_recording_duration_valid/);
      await expect(
        attempt(tx, (sp) => insertLog(sp, s, { recordingPath: "/assets/sample-recording.mp3", duration: null })),
      ).resolves.toBeTruthy();
      await expect(
        attempt(tx, (sp) => insertLog(sp, s, { recordingPath: "/assets/sample-recording.mp3", duration: 13.384671 })),
      ).resolves.toBeTruthy();
    });
  });

  it("restricts parent deletion while referenced and cascades only tag associations", async () => {
    await withRollback(sql, async (tx) => {
      const s = await seedScratch(tx);
      const [{ id: logId }] = (await insertLog(tx, s)) as unknown as { id: string }[];
      const tagId = randomUUID();
      await tx`insert into toph.tags (id, farm_id, label, normalized_label) values (${tagId}, ${s.farmA}, 'Urgent', 'urgent')`;
      await tx`insert into toph.work_log_tags (farm_id, work_log_id, tag_id) values (${s.farmA}, ${logId}, ${tagId})`;

      await expect(attempt(tx, (sp) => sp`delete from toph.employees where id = ${s.employeeA}`)).rejects.toThrow(
        /violates foreign key constraint/,
      );
      await expect(attempt(tx, (sp) => sp`delete from toph.fields where id = ${s.fieldA}`)).rejects.toThrow(
        /violates foreign key constraint/,
      );
      await expect(attempt(tx, (sp) => sp`delete from toph.farms where id = ${s.farmA}`)).rejects.toThrow(
        /violates foreign key constraint/,
      );

      await tx`delete from toph.work_logs where id = ${logId}`;
      const associations = await tx`select 1 from toph.work_log_tags where work_log_id = ${logId}`;
      const tags = await tx`select 1 from toph.tags where id = ${tagId}`;
      expect(associations.length).toBe(0);
      expect(tags.length).toBe(1);
    });
  });

  it("exposes one dashboard_logs row per log with tags aggregated in normalized order", async () => {
    await withRollback(sql, async (tx) => {
      const s = await seedScratch(tx);
      const [{ id: logId }] = (await insertLog(tx, s)) as unknown as { id: string }[];
      const tagIds = [randomUUID(), randomUUID(), randomUUID()];
      await tx`insert into toph.tags (id, farm_id, label, normalized_label) values
        (${tagIds[0]}, ${s.farmA}, 'Zebra', 'zebra'),
        (${tagIds[1]}, ${s.farmA}, 'apple', 'apple'),
        (${tagIds[2]}, ${s.farmA}, 'Mango', 'mango')`;
      for (const tagId of tagIds) {
        await tx`insert into toph.work_log_tags (farm_id, work_log_id, tag_id) values (${s.farmA}, ${logId}, ${tagId})`;
      }

      const rows = await tx<
        { id: string; employee_name: string; field_name: string; work_date: string; tags: { id: string; label: string }[] }[]
      >`select id, employee_name, field_name, work_date::text as work_date, tags from toph.dashboard_logs where farm_id = ${s.farmA}`;
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(logId);
      expect(rows[0].employee_name).toBe("Worker A");
      expect(rows[0].field_name).toBe("FIELD A");
      expect(rows[0].work_date).toBe("2026-04-19");
      expect(rows[0].tags.map((t) => t.label)).toEqual(["apple", "Mango", "Zebra"]);
    });
  });
});
