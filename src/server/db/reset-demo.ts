/**
 * Puts the whole database into the demo state: Bays Ranch exactly as seeded (the Figma dataset,
 * its eleven workers plus Ranch Admin, reviewed field map, sample reports and demo day) and
 * nothing else. Every table in the toph schema holds farm data, so all of them are emptied (other
 * farms and their people, sessions, logs, recordings, reports, satellite readings) before the seed
 * runs again. Migration history lives in the drizzle schema and is kept. One transaction: a
 * failure changes nothing.
 */
import type postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { ADMIN_ACCOUNT, FARM, INITIAL_EMPLOYEES, recordId } from "./initial-data";
import { seedInitialDataRows, type SeedReport } from "./seed";
import * as schema from "./schema";

export type DemoResetPlan = {
  /** Farms the reset deletes, with how many accounts and logs each has. */
  otherFarms: { name: string; accounts: number; logs: number }[];
  /** Bays Ranch accounts that are not one of the design's people. */
  extraBaysAccounts: string[];
};

export type DemoResetReport = { plan: DemoResetPlan; seed: SeedReport };

const DESIGN_ACCOUNT_IDS = [ADMIN_ACCOUNT.id, ...INITIAL_EMPLOYEES.map((row) => recordId("employee", row.n))];

async function readPlan(db: Pick<PostgresJsDatabase<typeof schema>, "execute">): Promise<DemoResetPlan> {
  const farms = await db.execute<{ name: string; accounts: number; logs: number }>(sql`select f.name,
      (select count(*)::int from toph.accounts a where a.farm_id = f.id) as accounts,
      (select count(*)::int from toph.work_logs l where l.farm_id = f.id) as logs
    from toph.farms f where f.id <> ${FARM.id} order by f.name, f.id`);
  const extra = await db.execute<{ name: string }>(sql`select name from toph.accounts
    where farm_id = ${FARM.id} and id not in ${DESIGN_ACCOUNT_IDS} order by name`);
  return {
    otherFarms: farms.map((row) => ({ name: row.name, accounts: row.accounts, logs: row.logs })),
    extraBaysAccounts: extra.map((row) => row.name),
  };
}

/** What `resetDemoState` would delete. Read-only. */
export function planDemoReset(client: postgres.Sql): Promise<DemoResetPlan> {
  return readPlan(drizzle(client, { schema }));
}

/**
 * `lockTimeoutMs` bounds the wait for another transaction's locks: emptying a table has to wait
 * for requests already reading it, and every later request would queue behind that wait.
 */
export async function resetDemoState(client: postgres.Sql, options: { lockTimeoutMs?: number } = {}): Promise<DemoResetReport> {
  const lockTimeout = `${Math.max(1, Math.trunc(options.lockTimeoutMs ?? 10_000))}ms`;
  return drizzle(client, { schema }).transaction(async (tx) => {
    await tx.execute(sql`select set_config('lock_timeout', ${lockTimeout}, true)`);
    const plan = await readPlan(tx);
    const tables = await tx.execute<{ name: string }>(sql`select format('%I.%I', schemaname, tablename) as name
      from pg_tables where schemaname = 'toph' order by tablename`);
    await tx.execute(sql.raw(`truncate table ${tables.map((table) => table.name).join(", ")}`));
    return { plan, seed: await seedInitialDataRows(tx) };
  });
}
