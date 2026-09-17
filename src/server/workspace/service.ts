import "server-only";
import type postgres from "postgres";
import type { WorkspaceResponse, WorkspaceState } from "@/contracts/workspace";
import type { FarmContext } from "@/server/farm-context";
import { ApiError, validationError } from "@/server/errors";
import { mapDatabaseError } from "@/server/db/errors";
import { makeWorkspaceSeed } from "./seed";
import { MAX_WORKSPACE_STATE_BYTES, parseWorkspacePatch, parseWorkspaceState } from "./validation";

type Row = { payload: WorkspaceState; revision: number };

// Drizzle configures postgres.js JSON parsers/serializers as identity functions on its pool.
// Cast the already encoded JSON explicitly, and accept either decoded or textual query results.
function decodePayload(payload: unknown): unknown {
  return typeof payload === "string" ? JSON.parse(payload) : payload;
}

async function initialize(tx: postgres.TransactionSql, ctx: FarmContext): Promise<void> {
  const existing = await tx`select farm_id from toph.workspace_state where farm_id = ${ctx.farmId}`;
  if (existing.length) return;
  const employees = await tx<{ id: string; display_name: string; is_active: boolean }[]>`
    select id, display_name, is_active from toph.employees where farm_id = ${ctx.farmId} order by id`;
  const fields = await tx<{ id: string; name: string }[]>`
    select id, name from toph.fields where farm_id = ${ctx.farmId} order by id`;
  const seed = parseWorkspaceState(makeWorkspaceSeed(ctx.farm, employees, fields));
  await tx`insert into toph.workspace_state (farm_id, payload, revision)
    values (${ctx.farmId}, ${JSON.stringify(seed)}::jsonb, 0) on conflict (farm_id) do nothing`;
}

async function validateRelationships(tx: postgres.TransactionSql, ctx: FarmContext, state: WorkspaceState): Promise<void> {
  const employeeIds = new Set(state.employees.map((employee) => employee.id));
  const originals = await tx<{ id: string }[]>`select id from toph.employees where farm_id = ${ctx.farmId}`;
  if (originals.some((employee) => !employeeIds.has(employee.id))) {
    throw validationError("Employees with recorded farm history must stay in the roster.", { employees: "Mark existing employees Inactive instead of removing them." });
  }
  // Existing IDs from another farm cannot be appropriated as new local employee IDs.
  const foreignEmployees = await tx<{ id: string }[]>`
    select id from toph.employees where farm_id <> ${ctx.farmId} and id = any(${Array.from(employeeIds)}::uuid[])`;
  if (foreignEmployees.length) throw validationError("An employee ID does not belong to this farm.", { employees: "Use a new UUID for a new employee." });
  const fields = await tx<{ id: string }[]>`select id from toph.fields where farm_id = ${ctx.farmId}`;
  const fieldIds = new Set(fields.map((field) => field.id));
  if (state.schedule.some((item) => !employeeIds.has(item.employeeId) || !fieldIds.has(item.fieldId))) {
    throw validationError("An assignment references an unknown employee or field.", { schedule: "Choose an employee and field belonging to this farm." });
  }
  if (state.messages.some((item) => !employeeIds.has(item.employeeId))) {
    throw validationError("A message references an unknown employee.", { messages: "Choose an employee from this farm’s roster." });
  }
  const logs = await tx<{ id: string }[]>`select id from toph.work_logs where farm_id = ${ctx.farmId}`;
  const logIds = new Set(logs.map((log) => log.id));
  if (state.reviews.some((item) => !logIds.has(item.logId))) {
    throw validationError("A review references an unknown farm log.", { reviews: "Choose a log belonging to this farm." });
  }
}

/** Atomic, first-read initialization only. Existing workspace data is never reseeded. */
export async function getWorkspace(ctx: FarmContext): Promise<WorkspaceResponse> {
  try {
    return await ctx.sql.begin(async (tx) => {
      await initialize(tx, ctx);
      const [row] = await tx<Row[]>`select payload, revision from toph.workspace_state where farm_id = ${ctx.farmId}`;
      return { data: parseWorkspaceState(decodePayload(row.payload)), revision: row.revision };
    });
  } catch (error) { throw mapDatabaseError(error) ?? error; }
}

/** Whole-section replacement under a row lock. A stale revision can never silently lose a write. */
export async function patchWorkspace(ctx: FarmContext, body: unknown): Promise<WorkspaceResponse> {
  const { patch, expectedRevision } = parseWorkspacePatch(body);
  try {
    return await ctx.sql.begin(async (tx) => {
      await initialize(tx, ctx);
      const [row] = await tx<Row[]>`select payload, revision from toph.workspace_state where farm_id = ${ctx.farmId} for update`;
      if (row.revision !== expectedRevision) {
        throw new ApiError(409, "REVISION_CONFLICT", "The workspace changed in another session. Reload and try again.");
      }
      const state = parseWorkspaceState({ ...parseWorkspaceState(decodePayload(row.payload)), ...patch });
      await validateRelationships(tx, ctx, state);
      const encoded = JSON.stringify(state);
      // PostgreSQL's canonical JSON includes spacing. Check its exact stored representation
      // as well as the compact request size so the SQL constraint never surfaces as a 500.
      const [{ bytes }] = await tx<{ bytes: number }[]>`select octet_length(${encoded}::jsonb::text) as bytes`;
      if (bytes > MAX_WORKSPACE_STATE_BYTES) {
        throw validationError("The workspace exceeds the storage limit.", { body: "Keep the total workspace under 1 MiB." });
      }
      const [saved] = await tx<Row[]>`update toph.workspace_state
        set payload = ${encoded}::jsonb, revision = revision + 1, updated_at = now()
        where farm_id = ${ctx.farmId} returning payload, revision`;
      return { data: parseWorkspaceState(decodePayload(saved.payload)), revision: saved.revision };
    });
  } catch (error) { throw mapDatabaseError(error) ?? error; }
}
