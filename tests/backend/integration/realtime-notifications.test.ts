import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type postgres from "postgres";
import type { MobileLogSubmission } from "@/contracts/mobile";
import { createFarmContext, type FarmContext } from "@/server/farm-context";
import { FARM_ID } from "@/server/db/initial-data";
import { applyRuntimeGrants } from "@/server/db/grants";
import { applyMobileGrants } from "@/server/mobile/grants";
import { getMobileBootstrap, updateMobileAccount } from "@/server/mobile/accounts";
import { saveMobileLog } from "@/server/mobile/logs";
import { applyRealtimeAccess, describeRealtimeAccess, LIVE_UPDATES_POLICY } from "@/server/realtime/access";
import { liveUpdatesTopic } from "@/server/realtime/config";
import { addLogTag } from "@/server/services/tags";
import { getWorkspace, patchWorkspace } from "@/server/workspace/service";
import { OTHER_FARM, prepareTestDatabase, resetTags } from "../helpers/prepare-db";
import { openTestSql } from "../helpers/test-db";
import { getTestDatabaseTarget } from "../helpers/test-env";

/**
 * The live-update triggers call Supabase's realtime.send(). Plain PostgreSQL has no such
 * function, so these tests install a recording stand-in with the same signature, RLS-enabled
 * messages table, and realtime.topic() helper. The real Realtime server is covered by the
 * manual verification in docs/backend/realtime.md.
 */
const RECEIVER_ROLE = "toph_test_live_receiver";
const ISAAC_LOG_ID = "30000000-0000-4000-8000-000000000001";

type Sent = { topic: string; event: string; private: boolean; extension: string; payload: Record<string, unknown> };

describe("live-update notifications", () => {
  let owner: postgres.Sql;
  let ctx: FarmContext;
  let createdRealtimeSchema = false;
  const logIds: string[] = [];

  const sent = () => owner<Sent[]>`select topic, event, private, extension, payload from realtime.messages order by inserted_at, id`;
  const kinds = async () => (await sent()).map((row) => `${row.topic}|${row.payload.kind}`).sort();

  beforeAll(async () => {
    const target = getTestDatabaseTarget();
    owner = openTestSql();
    await prepareTestDatabase(owner);
    await applyRuntimeGrants(owner, "toph_app");
    await applyMobileGrants(owner, "toph_app");
    // The restricted runtime role performs the writes: the trigger must work without granting
    // that role anything in the realtime schema.
    ctx = await createFarmContext({ databaseUrl: target.appUrl ?? target.url, farmId: FARM_ID });
  });

  afterAll(async () => {
    getTestDatabaseTarget();
    if (logIds.length) {
      await owner`delete from toph.work_log_tags where work_log_id = any(${logIds}::uuid[])`;
      await owner`delete from toph.mobile_submissions where log_id = any(${logIds}::uuid[])`;
      await owner`delete from toph.work_logs where id = any(${logIds}::uuid[])`;
    }
    await resetTags(owner);
    if (createdRealtimeSchema) await owner.unsafe(`drop schema if exists realtime cascade`);
    await owner.unsafe(`drop role if exists ${RECEIVER_ROLE}`);
    await owner`revoke insert on toph.work_logs, toph.employees from toph_app`;
    await owner`revoke update (display_name, avatar_path, updated_at) on toph.employees from toph_app`;
    await ctx?.close();
    await owner?.end();
  });

  it("is inert on PostgreSQL without Supabase Realtime: writes commit and access setup reports why", async () => {
    const [{ present }] = await owner<{ present: boolean }[]>`select to_regnamespace('realtime') is not null as present`;
    if (present) return; // A Supabase database: the stand-in below is not installed either.
    await owner`update toph.work_logs set updated_at = now() where id = ${ISAAC_LOG_ID}`;
    const workspace = await getWorkspace(ctx);
    await patchWorkspace(ctx, { expectedRevision: workspace.revision, patch: { settings: workspace.data.settings } });
    expect(await applyRealtimeAccess(owner)).toEqual({ applied: false, reason: "Supabase Realtime is not installed in this database." });
    expect((await describeRealtimeAccess(owner)).realtimeInstalled).toBe(false);
  });

  describe("with realtime.send available", () => {
    beforeAll(async () => {
      const [{ present }] = await owner<{ present: boolean }[]>`select to_regnamespace('realtime') is not null as present`;
      if (present) throw new Error("This suite installs a stand-in realtime schema and needs a database without one.");
      createdRealtimeSchema = true;
      await owner.unsafe(`
        create schema realtime;
        create table realtime.messages (
          id uuid primary key default gen_random_uuid(), payload jsonb, event text, topic text not null,
          private boolean default false, extension text not null, inserted_at timestamptz not null default clock_timestamp());
        alter table realtime.messages enable row level security;
        create function realtime.topic() returns text language sql stable as
          $$ select nullif(current_setting('realtime.topic', true), '')::text $$;
        create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void
        language plpgsql as $$
        begin
          if current_setting('toph_test.fail_send', true) = 'on' then raise exception 'simulated realtime outage'; end if;
          insert into realtime.messages (payload, event, topic, private, extension) values (payload, event, topic, private, 'broadcast');
        end $$;
        drop role if exists ${RECEIVER_ROLE};
        create role ${RECEIVER_ROLE} nologin;
        grant usage on schema realtime to ${RECEIVER_ROLE};
        grant select, insert, update on realtime.messages to ${RECEIVER_ROLE};`);
    });

    beforeEach(async () => { await owner`truncate realtime.messages`; });

    it("sends one content-free private signal per kind for a committed mobile log", async () => {
      const bootstrap = await getMobileBootstrap(ctx);
      const input: MobileLogSubmission = { contractVersion: "1", accountId: bootstrap.accounts[0].id, clientDraftId: randomUUID(), fieldId: bootstrap.fields[0].id,
        activity: "Spraying", workDate: "2026-09-16", startTime: "06:00", endTime: "08:00", notes: "Private note that must never be broadcast.", transcript: "Private transcript.",
        treatment: null, tags: ["Live one", "Live two"], recordings: [] };
      await owner`truncate realtime.messages`; // getMobileBootstrap may initialize the workspace row
      const receipt = await saveMobileLog(ctx, input, []);
      logIds.push(receipt.logId);

      const rows = await sent();
      expect(rows).toEqual([{ topic: liveUpdatesTopic(FARM_ID), event: "change", private: true, extension: "broadcast", payload: { v: 1, kind: "dashboard" } }]);
      expect(JSON.stringify(rows)).not.toMatch(/Private|Spraying|Live one/);
      expect(rows[0].topic).toBe(`toph:farm:${FARM_ID}`);

      // An identical retry commits nothing new and therefore signals nothing.
      await owner`truncate realtime.messages`;
      expect(await saveMobileLog(ctx, input, [])).toEqual(receipt);
      expect(await sent()).toEqual([]);
    });

    it("signals both reads for a mobile profile and photo edit, and only the workspace for a web save", async () => {
      const initial = await getMobileBootstrap(ctx);
      const { id, ...profile } = initial.accounts[0];
      const avatarUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
      await owner`truncate realtime.messages`;
      const saved = await updateMobileAccount(ctx, id, { expectedRevision: initial.revision, profile: { ...profile, phone: "555-0199", avatarUrl } });
      expect(await kinds()).toEqual([`toph:farm:${FARM_ID}|dashboard`, `toph:farm:${FARM_ID}|workspace`]);
      expect(JSON.stringify(await sent())).not.toMatch(/555-0199|base64/);

      await owner`truncate realtime.messages`;
      const workspace = await getWorkspace(ctx);
      await patchWorkspace(ctx, { expectedRevision: workspace.revision, patch: { settings: workspace.data.settings } });
      expect(await kinds()).toEqual([`toph:farm:${FARM_ID}|workspace`]);

      const current = await getMobileBootstrap(ctx);
      await updateMobileAccount(ctx, id, { expectedRevision: current.revision, profile });
      expect(saved.revision).toBeLessThan(current.revision);
    });

    it("signals a tag change once, keeps farms apart, and stays silent after a rollback", async () => {
      await addLogTag(ctx, ISAAC_LOG_ID, "Live tag");
      expect(await kinds()).toEqual([`toph:farm:${FARM_ID}|dashboard`]);

      await owner`truncate realtime.messages`;
      await owner`update toph.work_logs set updated_at = now() where farm_id = ${OTHER_FARM.id}`;
      expect(await kinds()).toEqual([`toph:farm:${OTHER_FARM.id}|dashboard`]);

      await owner`truncate realtime.messages`;
      await owner.begin(async (tx) => {
        await tx`update toph.work_logs set updated_at = now() where farm_id = ${FARM_ID}`;
        await tx`update toph.employees set updated_at = now() where farm_id = ${FARM_ID}`;
        expect((await tx`select count(*)::int as n from realtime.messages`)[0].n).toBe(1);
        throw new Error("roll back");
      }).catch(() => undefined);
      expect(await sent()).toEqual([]);

      // Separate commits are separate signals.
      await owner`update toph.work_logs set updated_at = now() where id = ${ISAAC_LOG_ID}`;
      await owner`update toph.work_logs set updated_at = now() where id = ${ISAAC_LOG_ID}`;
      expect(await kinds()).toHaveLength(2);
    });

    it("never fails the farm's write when the notification cannot be sent", async () => {
      await owner.begin(async (tx) => {
        await tx`select set_config('toph_test.fail_send', 'on', true)`;
        await tx`update toph.work_logs set updated_at = now() where id = ${ISAAC_LOG_ID}`;
      });
      expect(await sent()).toEqual([]);
    });

    it("lets the anonymous receiving role read only the sample farm topic and never send", async () => {
      expect(await applyRealtimeAccess(owner, RECEIVER_ROLE)).toEqual({ applied: true });
      expect(await applyRealtimeAccess(owner, RECEIVER_ROLE)).toEqual({ applied: true }); // idempotent
      const state = await describeRealtimeAccess(owner, RECEIVER_ROLE);
      expect(state).toMatchObject({ realtimeInstalled: true, policy: { name: LIVE_UPDATES_POLICY, command: "SELECT", roles: [RECEIVER_ROLE] } });
      expect(state.triggers).toEqual(["employees", "fields", "work_log_tags", "work_logs", "workspace_state"]);

      await owner`update toph.work_logs set updated_at = now() where id = ${ISAAC_LOG_ID}`;
      await owner`update toph.work_logs set updated_at = now() where farm_id = ${OTHER_FARM.id}`;
      await owner`select realtime.send('{"v":1}'::jsonb, 'change', 'someone-elses-topic', true)`;
      const visible = async (topic: string) => owner.begin(async (tx) => {
        await tx`select set_config('realtime.topic', ${topic}, true)`;
        await tx.unsafe(`set local role ${RECEIVER_ROLE}`);
        return (await tx`select count(*)::int as n from realtime.messages`)[0].n as number;
      });
      expect(await visible(liveUpdatesTopic(FARM_ID))).toBeGreaterThan(0);
      expect(await visible(liveUpdatesTopic(OTHER_FARM.id))).toBe(0);
      expect(await visible("someone-elses-topic")).toBe(0);
      expect(await visible(`toph:farm:${FARM_ID}:extra`)).toBe(0);
      expect(await visible("toph:farm:not-a-uuid")).toBe(0);

      await expect(owner.begin(async (tx) => {
        await tx`select set_config('realtime.topic', ${liveUpdatesTopic(FARM_ID)}, true)`;
        await tx.unsafe(`set local role ${RECEIVER_ROLE}`);
        await tx`insert into realtime.messages (payload, event, topic, private, extension) values ('{"kind":"dashboard"}'::jsonb, 'change', ${liveUpdatesTopic(FARM_ID)}, true, 'broadcast')`;
      })).rejects.toThrow(/row-level security/);
    });

    it("keeps the private schema closed to the receiving role", async () => {
      const [privileges] = await owner<{ schema_usage: boolean; logs: boolean; recordings: boolean }[]>`
        select has_schema_privilege(${RECEIVER_ROLE}, 'toph', 'USAGE') as schema_usage,
               has_table_privilege(${RECEIVER_ROLE}, 'toph.work_logs', 'SELECT') as logs,
               has_table_privilege(${RECEIVER_ROLE}, 'toph.mobile_recordings', 'SELECT') as recordings`;
      expect(privileges).toEqual({ schema_usage: false, logs: false, recordings: false });
      const published = await owner`select 1 from pg_publication_tables where schemaname = 'toph'`;
      expect(published).toHaveLength(0);
    });
  });
});
