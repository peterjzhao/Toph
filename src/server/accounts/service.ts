import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { AccountRole, AccountSession, AuthClient, FarmMemberDto } from "@/contracts/accounts";
import type { WorkspaceState } from "@/contracts/workspace";
import type { FarmContext } from "@/server/farm-context";
import { getRuntimeDatabase } from "@/server/db/client";
import { ApiError, forbidden, notFound, validationError } from "@/server/errors";
import { assertWriteOrigin, normalizeOrigin } from "@/server/http/origin";
import { normalizeAccountName } from "./validation";

export const SAMPLE_FARM_ID = "00000000-0000-4000-8000-000000000001";
export const SAMPLE_ADMIN_ID = "90000000-0000-4000-8000-000000000001";
export const SESSION_COOKIE = "toph_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
type Queryable = postgres.Sql | postgres.TransactionSql;
type AccountRow = { id: string; farm_id: string; employee_id: string | null; name: string; role: AccountRole };
export type AccountContext = FarmContext & { account: AccountSession["account"]; session: AccountSession; tokenHash: string };

export function nameTaken(error: unknown): never {
  if (typeof error === "object" && error !== null && (error as { code?: string }).code === "23505" && (error as { constraint_name?: string }).constraint_name?.includes("normalized_name")) {
    throw new ApiError(409, "NAME_TAKEN", "That name already has an account. Log in or choose a different name.", { name: "This name is already in use." });
  }
  throw error;
}
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const joinCode = () => randomBytes(6).toString("hex").toUpperCase();
const unauthorized = () => new ApiError(401, "UNAUTHORIZED", "Sign in to continue.");

function tokenFromRequest(request: Request): { token: string; client: AuthClient } | null {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
    return match ? { token: match[1], client: "mobile" } : null;
  }
  const cookie = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${SESSION_COOKIE}=`));
  const token = cookie?.slice(SESSION_COOKIE.length + 1);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? { token, client: "web" } : null;
}

export function assertAccountWrite(request: Request, client?: AuthClient): void {
  const mobile = client === "mobile" || request.headers.has("authorization");
  if (!mobile) return assertWriteOrigin(request, process.env.APP_ORIGIN ?? null);
  if (request.headers.get("x-toph-client") !== "toph-mobile") throw forbidden("Use the Toph mobile client.");
  const origin = request.headers.get("origin");
  if (origin && normalizeOrigin(origin) !== normalizeOrigin(process.env.APP_ORIGIN)) throw forbidden("This origin is not allowed.");
}

export function sessionCookie(token: string, request: Request, clear = false): string {
  const secure = new URL(request.url).protocol === "https:" || process.env.NODE_ENV === "production";
  return `${SESSION_COOKIE}=${clear ? "" : token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : SESSION_SECONDS}${secure ? "; Secure" : ""}`;
}

async function sessionData(sql: Queryable, account: AccountRow): Promise<AccountSession> {
  const [farm] = await sql`select f.id, f.name, f.timezone, a.is_sample, a.setup_complete, a.join_code
    from toph.farms f join toph.farm_access a on a.farm_id = f.id where f.id = ${account.farm_id}`;
  if (!farm) throw unauthorized();
  return { account: { id: account.id, name: account.name, role: account.role, employeeId: account.employee_id },
    farm: { id: farm.id, name: farm.name, timezone: farm.timezone, isSample: farm.is_sample, setupComplete: farm.setup_complete },
    ...(account.role === "admin" ? { joinCode: farm.join_code } : {}) };
}

async function createSession(sql: Queryable, account: AccountRow, client: AuthClient) {
  if (client === "web" && account.role !== "admin") throw forbidden("Workers sign in through the mobile app.");
  if (client === "mobile" && account.role !== "worker") throw forbidden("Farm administrators sign in through the web dashboard.");
  const token = randomBytes(32).toString("base64url");
  await sql`insert into toph.account_sessions (token_hash, account_id, client, expires_at)
    values (${hashToken(token)}, ${account.id}, ${client}, ${new Date(Date.now() + SESSION_SECONDS * 1000).toISOString()})`;
  return { session: await sessionData(sql, account), token };
}

export async function resolveAccountContext(request: Request, role?: AccountRole): Promise<AccountContext> {
  const credential = tokenFromRequest(request);
  if (!credential) throw unauthorized();
  const { db, sql } = getRuntimeDatabase();
  const tokenHash = hashToken(credential.token);
  const [account] = await sql<AccountRow[]>`select a.id, a.farm_id, a.employee_id, a.name, a.role
    from toph.account_sessions s join toph.accounts a on a.id = s.account_id
    left join toph.employees e on e.id = a.employee_id and e.farm_id = a.farm_id
    where s.token_hash = ${tokenHash} and s.client = ${credential.client} and s.revoked_at is null
      and s.expires_at > now() and a.is_active and (a.role = 'admin' or e.is_active)`;
  if (!account) throw unauthorized();
  if (role && account.role !== role) throw forbidden(role === "admin" ? "This dashboard is for farm administrators." : "Use a worker account in the mobile app.");
  const session = await sessionData(sql, account);
  const [farm] = await sql`select avatar_path from toph.farms where id = ${account.farm_id}`;
  return { db, sql, farmId: session.farm.id, farm: { id: session.farm.id, name: session.farm.name, timezone: session.farm.timezone, avatarPath: farm.avatar_path },
    account: session.account, session, tokenHash, close: async () => undefined };
}

function emptyWorkspace(name: string, farmName: string, timezone: string): WorkspaceState {
  return { employees: [], schedule: [], reviews: [], reports: [], messages: [], tickets: [],
    settings: { farmName, contactName: name, email: "", timezone, notifications: { recordings: true, weekly: true, reminders: true } } };
}

export async function signupFarm(input: { name: string; farmName: string; timezone: string; client: AuthClient }) {
  if (input.client !== "web") throw forbidden("Create a farm using the web signup page.");
  const name = normalizeAccountName(input.name);
  const { sql } = getRuntimeDatabase();
  try {
    return await sql.begin(async tx => {
      const farmId = randomUUID();
      const id = randomUUID();
      await tx`insert into toph.farms (id, name, timezone) values (${farmId}, ${input.farmName}, ${input.timezone})`;
      await tx`insert into toph.farm_access (farm_id, join_code) values (${farmId}, ${joinCode()})`;
      const [account] = await tx<AccountRow[]>`insert into toph.accounts (id, farm_id, name, normalized_name, role)
        values (${id}, ${farmId}, ${name.name}, ${name.normalizedName}, 'admin') returning *`;
      await tx`insert into toph.workspace_state (farm_id, payload) values (${farmId}, ${JSON.stringify(emptyWorkspace(name.name, input.farmName, input.timezone))}::jsonb)`;
      return createSession(tx, account, input.client);
    });
  } catch (error) { return nameTaken(error); }
}

export async function joinFarm(input: { name: string; code: string; client: AuthClient }) {
  if (input.client !== "mobile") throw forbidden("Join a farm through the mobile app.");
  const name = normalizeAccountName(input.name);
  const { sql } = getRuntimeDatabase();
  try {
    return await sql.begin(async tx => {
      const [farm] = await tx`select farm_id, is_sample from toph.farm_access where join_code = ${input.code} for update`;
      if (!farm || farm.is_sample) throw validationError("That farm code is not available.", { code: "Check the code with your farm administrator." });
      const [workspace] = await tx`select payload from toph.workspace_state where farm_id = ${farm.farm_id} for update`;
      if (!workspace) throw notFound("Farm not found.");
      const state: WorkspaceState = typeof workspace.payload === "string" ? JSON.parse(workspace.payload) : workspace.payload;
      const id = randomUUID(); const employeeId = randomUUID();
      await tx`insert into toph.employees (id, farm_id, display_name) values (${employeeId}, ${farm.farm_id}, ${name.name})`;
      const [account] = await tx<AccountRow[]>`insert into toph.accounts (id, farm_id, employee_id, name, normalized_name, role)
        values (${id}, ${farm.farm_id}, ${employeeId}, ${name.name}, ${name.normalizedName}, 'worker') returning *`;
      state.employees.push({ id: employeeId, name: name.name, role: "Farm worker", email: "", phone: "", status: "Active", joinedAt: new Date().toISOString().slice(0, 10) });
      await tx`update toph.workspace_state set payload = ${JSON.stringify(state)}::jsonb, revision = revision + 1, updated_at = now() where farm_id = ${farm.farm_id}`;
      return createSession(tx, account, input.client);
    });
  } catch (error) { return nameTaken(error); }
}

export async function loginAccount(input: { name: string; client: AuthClient }) {
  const { normalizedName } = normalizeAccountName(input.name);
  const { sql } = getRuntimeDatabase();
  return sql.begin(async tx => {
    const [account] = await tx<AccountRow[]>`select a.id, a.farm_id, a.employee_id, a.name, a.role
      from toph.accounts a left join toph.employees e on e.id = a.employee_id and e.farm_id = a.farm_id
      where a.normalized_name = ${normalizedName} and a.is_active and (a.role = 'admin' or e.is_active) for update of a`;
    if (!account) throw new ApiError(401, "UNAUTHORIZED", "No active account has that name. Check your name or sign up.");
    return createSession(tx, account, input.client);
  });
}

export async function enterSample(client: AuthClient) {
  const { sql } = getRuntimeDatabase();
  return sql.begin(async tx => {
    const id = client === "mobile" ? "10000000-0000-4000-8000-000000000001" : SAMPLE_ADMIN_ID;
    const [account] = await tx<AccountRow[]>`select * from toph.accounts where id = ${id} and farm_id = ${SAMPLE_FARM_ID} and is_active`;
    if (!account) throw notFound("The sample farm is not installed. Ask the operator to seed it.");
    return createSession(tx, account, client);
  });
}

export async function logoutAccount(request: Request): Promise<void> {
  const credential = tokenFromRequest(request);
  if (!credential) return;
  const { sql } = getRuntimeDatabase();
  await sql`update toph.account_sessions set revoked_at = now() where token_hash = ${hashToken(credential.token)} and client = ${credential.client}`;
}

export async function listFarmMembers(ctx: AccountContext): Promise<FarmMemberDto[]> {
  const rows = await ctx.sql`select id, name, employee_id, role, is_active from toph.accounts where farm_id = ${ctx.farmId} order by role, name`;
  return rows.map(row => ({ id: row.id, name: row.name, employeeId: row.employee_id, role: row.role, active: row.is_active }));
}

export async function rotateJoinCode(ctx: AccountContext): Promise<string> {
  if (ctx.session.farm.isSample) throw forbidden("The sample farm's membership is fixed.");
  const code = joinCode();
  await ctx.sql`update toph.farm_access set join_code = ${code} where farm_id = ${ctx.farmId}`;
  return code;
}

export async function deactivateMember(ctx: AccountContext, accountId: string): Promise<void> {
  if (ctx.session.farm.isSample) throw forbidden("The sample farm's membership is fixed.");
  await ctx.sql.begin(async tx => {
    // Lock the workspace before changing membership; log saving uses the same lock.
    const [workspace] = await tx`select payload from toph.workspace_state where farm_id = ${ctx.farmId} for update`;
    const [account] = await tx`update toph.accounts set is_active = false where farm_id = ${ctx.farmId} and id = ${accountId} and role = 'worker' returning employee_id`;
    if (!account) throw notFound("Worker not found.");
    await tx`update toph.employees set is_active = false, updated_at = now() where farm_id = ${ctx.farmId} and id = ${account.employee_id}`;
    await tx`update toph.account_sessions set revoked_at = now() where account_id = ${accountId} and revoked_at is null`;
    const state: WorkspaceState = typeof workspace.payload === "string" ? JSON.parse(workspace.payload) : workspace.payload;
    const employee = state.employees.find(row => row.id === account.employee_id);
    if (employee) employee.status = "Inactive";
    await tx`update toph.workspace_state set payload = ${JSON.stringify(state)}::jsonb, revision = revision + 1, updated_at = now() where farm_id = ${ctx.farmId}`;
  });
}

export function assertOwnEmployee(ctx: AccountContext, employeeId: string): void {
  if (!ctx.account.employeeId || employeeId.toLowerCase() !== ctx.account.employeeId) throw forbidden("You can only access your own worker account.");
}
