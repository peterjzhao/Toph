import { createSqlClient } from "../../src/server/db/connection";
import { applyMobileGrants } from "../../src/server/mobile/grants";
import { loadLocalEnv, requireEnv } from "./lib/env";
loadLocalEnv();
async function main() {
  const sql = createSqlClient(requireEnv("DATABASE_MIGRATION_URL", "Use the schema owner connection."), { max: 1, sslCaPath: process.env.DATABASE_SSL_CA_PATH });
  try { await applyMobileGrants(sql, requireEnv("DATABASE_APP_ROLE", "Set the restricted application role.")); console.log("Mobile runtime grants applied. Set TOPH_MOBILE_ENABLED=true to enable the mobile routes."); }
  finally { await sql.end(); }
}
main().catch(() => { console.error("Could not enable mobile grants. Check the database configuration and migrations."); process.exitCode = 1; });
