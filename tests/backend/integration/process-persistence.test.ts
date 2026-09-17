import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { ISAAC_LOG_ID } from "@/server/db/initial-data";
import { openTestSql } from "../helpers/test-db";
import { prepareTestDatabase, resetTags } from "../helpers/prepare-db";

const run = promisify(execFile);
const projectRoot = path.resolve(__dirname, "../../..");
const harness = path.join(projectRoot, "tests/backend/helpers/tag-process.ts");

type HarnessResult = { pid: number; result: { logId: string; tags: { id: string; label: string }[] } };

async function inFreshProcess(...args: string[]): Promise<HarnessResult> {
  const { stdout } = await run(process.execPath, ["--import", "tsx", "--conditions=react-server", harness, ...args], {
    cwd: projectRoot,
    env: { ...process.env, NODE_ENV: "test" },
    timeout: 60_000,
  });
  return JSON.parse(stdout.trim().split("\n").pop() as string) as HarnessResult;
}

/**
 * Spec check 4: a tag added by one process must be visible after that process has exited, from
 * a different process with its own connection. This stands in for an application restart without
 * touching the frontend's running development server.
 */
describe("tag persistence across isolated processes", () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = openTestSql();
    await prepareTestDatabase(sql);
    await resetTags(sql);
  });

  afterAll(async () => {
    await resetTags(sql);
    await sql.end();
  });

  it("survives process exit and removal persists the same way", async () => {
    const added = await inFreshProcess("add", ISAAC_LOG_ID, "Survives restart");
    expect(added.result.tags.map((t) => t.label)).toEqual(["Survives restart"]);

    const read = await inFreshProcess("read", ISAAC_LOG_ID);
    expect(read.pid).not.toBe(added.pid);
    expect(read.result.tags).toEqual(added.result.tags);

    const removed = await inFreshProcess("remove", ISAAC_LOG_ID, added.result.tags[0].id);
    expect(removed.result.tags).toEqual([]);

    const readAgain = await inFreshProcess("read", ISAAC_LOG_ID);
    expect(readAgain.result.tags).toEqual([]);
  });
});
