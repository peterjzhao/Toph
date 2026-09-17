/**
 * Isolated-process harness for the persistence check: each invocation is a fresh Node process
 * with its own database connection, so nothing in memory can carry a tag between steps.
 *
 * Usage (from the test suite):
 *   node --import tsx --conditions=react-server tests/backend/helpers/tag-process.ts add <logId> <label>
 *   node --import tsx --conditions=react-server tests/backend/helpers/tag-process.ts read <logId>
 *   node --import tsx --conditions=react-server tests/backend/helpers/tag-process.ts remove <logId> <tagId>
 *
 * It connects to TEST_DATABASE_URL only and prints a JSON result on stdout.
 */
import { createFarmContext } from "@/server/farm-context";
import { FARM_ID } from "@/server/db/initial-data";
import { getLog } from "@/server/services/dashboard";
import { addLogTag, removeLogTag } from "@/server/services/tags";
import { getTestDatabaseTarget } from "./test-env";

async function main(): Promise<void> {
  const [command, logId, argument] = process.argv.slice(2);
  const ctx = await createFarmContext({
    databaseUrl: getTestDatabaseTarget().url,
    farmId: FARM_ID,
    poolMax: 1,
  });
  try {
    let result: unknown;
    switch (command) {
      case "add":
        result = await addLogTag(ctx, logId, argument);
        break;
      case "remove":
        result = await removeLogTag(ctx, logId, argument);
        break;
      case "read":
        result = { logId, tags: (await getLog(ctx, logId)).tags };
        break;
      default:
        throw new Error(`Unknown command: ${command}`);
    }
    process.stdout.write(`${JSON.stringify({ pid: process.pid, result })}\n`);
  } finally {
    await ctx.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
