/**
 * Explicit operator opt-in for live updates on a Supabase database. The triggers in
 * drizzle/0007 write content-free signals to Supabase Realtime's private broadcast table;
 * this grants the public API role permission to RECEIVE them on farm topics, and nothing else.
 *
 * There is deliberately no INSERT policy: browsers can listen but never send, so a signal can
 * only originate from a committed change inside the database. No toph table is exposed or
 * published, and the policy cannot reach the private schema.
 *
 * Applied by `npm run db:enable-realtime` with the migration connection. Idempotent.
 */
import type postgres from "postgres";
import { RUNTIME_ROLE_PATTERN } from "@/server/db/grants";

export const LIVE_UPDATES_POLICY = "toph_live_updates_receive";
/** Role a browser connection assumes with only the publishable/anon key. */
export const LIVE_UPDATES_ROLE = "anon";

// Exactly the topic shape built by toph.notify_farm_change(): toph:farm:<uuid>.
const DEMO_TOPIC = "toph:farm:00000000-0000-4000-8000-000000000001";

export type RealtimeAccessResult = { applied: true } | { applied: false; reason: string };

export type RealtimeAccessState = {
  realtimeInstalled: boolean;
  /** Tables whose changes signal open dashboards (from migration 0007). */
  triggers: string[];
  policy: { name: string; command: string; roles: string[] } | null;
  /** Must stay empty: private tables never join a Realtime publication. */
  publishedPrivateTables: string[];
};

type Queryable = postgres.Sql | postgres.TransactionSql;

async function realtimeInstalled(sql: Queryable): Promise<boolean> {
  const [{ installed }] = await sql<{ installed: boolean }[]>`
    select to_regclass('realtime.messages') is not null
       and to_regprocedure('realtime.topic()') is not null
       and to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null as installed`;
  return installed;
}

export async function applyRealtimeAccess(sql: postgres.Sql, role: string = LIVE_UPDATES_ROLE): Promise<RealtimeAccessResult> {
  if (!RUNTIME_ROLE_PATTERN.test(role)) throw new Error(`Invalid role name: ${JSON.stringify(role)}`);
  if (!(await realtimeInstalled(sql))) return { applied: false, reason: "Supabase Realtime is not installed in this database." };
  const [{ exists }] = await sql<{ exists: boolean }[]>`select exists(select 1 from pg_roles where rolname = ${role}) as exists`;
  if (!exists) return { applied: false, reason: `Role "${role}" does not exist.` };

  await sql.begin(async (tx) => {
    await tx`drop policy if exists ${tx(LIVE_UPDATES_POLICY)} on realtime.messages`;
    await tx.unsafe(`create policy ${LIVE_UPDATES_POLICY} on realtime.messages for select to ${role}
      using (extension = 'broadcast' and realtime.topic() = '${DEMO_TOPIC}')`);
  });
  return { applied: true };
}

export async function describeRealtimeAccess(sql: postgres.Sql, role: string = LIVE_UPDATES_ROLE): Promise<RealtimeAccessState> {
  const installed = await realtimeInstalled(sql);
  const triggers = await sql<{ table_name: string }[]>`
    select c.relname as table_name
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'toph' and p.proname = 'notify_farm_change' and not t.tgisinternal
    order by c.relname`;
  const policies = installed
    ? await sql<{ name: string; command: string; roles: string[] }[]>`
        select policyname as name, cmd as command, roles::text[] as roles from pg_policies
        where schemaname = 'realtime' and tablename = 'messages' and policyname = ${LIVE_UPDATES_POLICY} and ${role} = any(roles::text[])`
    : [];
  const published = await sql<{ table_name: string }[]>`
    select schemaname || '.' || tablename as table_name from pg_publication_tables where schemaname = 'toph' order by 1`;
  return {
    realtimeInstalled: installed,
    triggers: triggers.map((row) => row.table_name),
    policy: policies[0] ? { name: policies[0].name, command: policies[0].command, roles: policies[0].roles } : null,
    publishedPrivateTables: published.map((row) => row.table_name),
  };
}

/**
 * Writes one signal and rolls it back, proving the connection's role can reach Realtime's
 * message table (including today's partition) without broadcasting anything.
 */
export async function canWriteRealtimeSignal(sql: postgres.Sql): Promise<boolean> {
  if (!(await realtimeInstalled(sql))) return false;
  const topic = "toph:self-check";
  let written = false;
  await sql.begin(async (tx) => {
    await tx`select realtime.send('{"v":1}'::jsonb, 'self-check', ${topic}, true)`;
    const [{ count }] = await tx<{ count: number }[]>`select count(*)::int as count from realtime.messages where topic = ${topic}`;
    written = count > 0;
    throw new Error("roll back the self-check");
  }).catch((error: unknown) => {
    if (!(error instanceof Error) || error.message !== "roll back the self-check") throw error;
  });
  return written;
}
