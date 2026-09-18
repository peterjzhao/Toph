import { execFile } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { FARM_ID } from "@/server/db/initial-data";
import { runMigrations } from "@/server/db/migrate";
import { SAMPLE_REPORTS } from "@/server/db/sample-reports";
import { dropBackendSchemas, openTestSql } from "../helpers/test-db";
import { prepareTestDatabase } from "../helpers/prepare-db";
import { getTestDatabaseTarget } from "../helpers/test-env";

const run = promisify(execFile);
const projectRoot = path.resolve(__dirname, "../../..");
const journal = JSON.parse(readFileSync(path.join(projectRoot, "drizzle/meta/_journal.json"), "utf8")) as { entries: { idx: number }[] };
const PENDING = 2;

/** Runs `npm run db:reset-demo` as its own process against the TEST database only. */
async function resetDemoCommand(...args: string[]): Promise<{ code: number; output: string }> {
  const { url } = getTestDatabaseTarget();
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_MIGRATION_URL: url, DATABASE_APP_ROLE: "toph_app", NODE_ENV: "test" };
  delete env.DATABASE_URL;
  try {
    const { stdout, stderr } = await run(process.execPath, ["--import", "tsx", "scripts/db/reset-demo.ts", ...args], { cwd: projectRoot, env, timeout: 120_000 });
    return { code: 0, output: stdout + stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? -1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

describe("npm run db:reset-demo", () => {
  let sql: postgres.Sql;
  const behind = mkdtempSync(path.join(tmpdir(), "toph-migrations-"));

  beforeAll(async () => {
    sql = openTestSql();
    // A database two migrations behind the code, holding Bays Ranch and a farm that isn't in the
    // design, so the pending migrations run against real rows the way they do in production.
    cpSync(path.join(projectRoot, "drizzle"), behind, { recursive: true });
    writeFileSync(path.join(behind, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, -PENDING) }));
    await dropBackendSchemas(sql);
    await runMigrations(getTestDatabaseTarget().url, { migrationsFolder: behind });
    await sql`insert into toph.farms (id, name, timezone) values (${FARM_ID}, 'Bays Ranch', 'America/Los_Angeles'), ('00000000-0000-4000-8000-0000000000aa', 'Visitor Farm', 'UTC')`;
    await sql`insert into toph.accounts (id, farm_id, name, normalized_name, role) values ('90000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000aa', 'Visitor Admin', 'visitor admin', 'admin')`;
  });
  afterAll(async () => {
    rmSync(behind, { recursive: true, force: true });
    await prepareTestDatabase(sql);
    await sql.end();
  });

  it("only previews without --yes: it names the test database and the farm it would delete, and changes nothing", async () => {
    const { code, output } = await resetDemoCommand();
    expect(code).toBe(2);
    expect(output).toContain("toph_test");
    expect(output).toContain("Visitor Farm");
    expect((await sql`select count(*)::int as n from drizzle.__drizzle_migrations`)[0].n).toBe(journal.entries.length - PENDING);
    expect((await sql`select name from toph.farms order by name`).map((row) => row.name)).toEqual(["Bays Ranch", "Visitor Farm"]);
  });

  it("applies the pending migrations and grants, then leaves only Bays Ranch as in the design", async () => {
    const { code, output } = await resetDemoCommand("--yes");
    expect(code, output).toBe(0);
    expect(output).toContain(`Migrations applied now: ${PENDING}`);
    expect((await sql`select count(*)::int as n from drizzle.__drizzle_migrations`)[0].n).toBe(journal.entries.length);
    expect((await sql`select name from toph.farms`).map((row) => row.name)).toEqual(["Bays Ranch"]);
    expect((await sql`select count(*)::int as n from toph.accounts`)[0].n).toBe(12);
    const reports = await sql<{ id: string; document: unknown }[]>`select id, document from toph.farm_reports order by id`;
    expect(reports.map((row) => [row.id, row.document])).toEqual(SAMPLE_REPORTS.map((report) => [report.id, report.document]));
    const [grant] = await sql`select has_table_privilege('toph_app', 'toph.farm_reports', 'INSERT') as insert`;
    expect(grant.insert).toBe(true);
  });
});
