/**
 * Explicit operator opt-in for dashboard live updates on a Supabase database.
 * Lets the public API role RECEIVE the content-free signals written by migration 0007;
 * it grants no access to the private toph schema and no permission to send.
 * Uses DATABASE_MIGRATION_URL (owner connection), never DATABASE_URL. Idempotent.
 *
 *   npm run db:enable-realtime            apply, then report
 *   npm run db:enable-realtime -- --check report only; changes nothing
 */
import { createSqlClient } from "../../src/server/db/connection";
import { applyRealtimeAccess, canWriteRealtimeSignal, describeRealtimeAccess, LIVE_UPDATES_ROLE } from "../../src/server/realtime/access";
import { describeUrl, loadLocalEnv, requireEnv } from "./lib/env";

const EXPECTED_TRIGGERS = ["employees", "fields", "work_log_tags", "work_logs", "workspace_state"];

loadLocalEnv();
async function main() {
  const checkOnly = process.argv.includes("--check");
  const url = requireEnv("DATABASE_MIGRATION_URL", "Use the schema owner connection.");
  const sql = createSqlClient(url, { max: 1, sslCaPath: process.env.DATABASE_SSL_CA_PATH?.trim() || null, applicationName: "toph-realtime" });
  let ok = true;
  const report = (passed: boolean, message: string) => { if (!passed) ok = false; console.log(`${passed ? "PASS" : "FAIL"}  ${message}`); };
  try {
    console.log(`${checkOnly ? "Checking" : "Enabling"} live updates on ${describeUrl(url)}`);
    if (!checkOnly) {
      const result = await applyRealtimeAccess(sql);
      if (!result.applied) console.log(`INFO  Receive policy not applied: ${result.reason}`);
    }
    const state = await describeRealtimeAccess(sql);
    report(EXPECTED_TRIGGERS.every((table) => state.triggers.includes(table)), `change triggers exist on ${EXPECTED_TRIGGERS.join(", ")}${state.triggers.length ? "" : " (run npm run db:migrate)"}`);
    report(state.publishedPrivateTables.length === 0, `no private table is in a Realtime publication${state.publishedPrivateTables.length ? `: ${state.publishedPrivateTables.join(", ")}` : ""}`);
    if (!state.realtimeInstalled) {
      console.log("INFO  This database has no Supabase Realtime (for example local Docker PostgreSQL). Triggers stay inert and dashboards do not update live here.");
      return;
    }
    report(state.policy?.command === "SELECT", `role ${LIVE_UPDATES_ROLE} may receive farm live-update signals, and only receive${state.policy ? "" : " (run npm run db:enable-realtime)"}`);
    report(await canWriteRealtimeSignal(sql), "the database can write a Realtime signal (rolled back; nothing was broadcast)");
    if (ok) console.log("Next: set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY for the web server. See docs/backend/realtime.md.");
  } finally { await sql.end(); }
  if (!ok) process.exitCode = 1;
}
main().catch(() => { console.error("Could not configure live updates. Check the database configuration and migrations."); process.exitCode = 1; });
