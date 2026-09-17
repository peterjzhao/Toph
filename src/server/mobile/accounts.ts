import "server-only";
import { z } from "zod";
import type { MobileAccount, MobileAccountEdit, MobileBootstrap } from "@/contracts/mobile";
import type { FarmContext } from "@/server/farm-context";
import { ApiError, notFound, validationError } from "@/server/errors";
import { getWorkspace } from "@/server/workspace/service";
import { parseWorkspaceState } from "@/server/workspace/validation";
import { parseUuid } from "@/server/validation/ids";
import { normalizeAccountName } from "@/server/accounts/validation";
import { nameTaken } from "@/server/accounts/service";

export const MAX_MOBILE_AUDIO_BYTES = 3_800_000;
const avatar = z.string().max(180_000).nullable().refine(value => {
  if (value === null) return true;
  // Existing application assets and our compressed JPEG/PNG thumbnails only.
  if (/^\/assets\/[\w/.-]+\.(jpg|jpeg|png|webp)$/.test(value)) return true;
  const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 128_000 || bytes.toString("base64") !== match[2]) return false;
  return match[1] === "jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff : bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
}, "Choose a JPEG or PNG profile photo under 128 KB.");
const editSchema = z.object({
  expectedRevision: z.number().int().min(0).max(2147483646),
  profile: z.object({
    name: z.string().trim().min(1).max(80), role: z.string().trim().min(1).max(80),
    email: z.union([z.literal(""), z.string().trim().email().max(254)]), phone: z.string().trim().max(60),
    avatarUrl: avatar, defaultField: z.string().trim().max(120), defaultActivity: z.string().trim().min(1).max(80),
  }).strict(),
}).strict();
export function parseAccountEdit(body: unknown): { expectedRevision: number; profile: MobileAccountEdit } {
  const parsed = editSchema.safeParse(body);
  if (!parsed.success) throw validationError("Check your account details.", Object.fromEntries(parsed.error.issues.map(issue => [issue.path.join("."), issue.message])));
  return parsed.data;
}

export async function getMobileBootstrap(ctx: FarmContext): Promise<MobileBootstrap> {
  const workspace = await getWorkspace(ctx);
  const [fields, profiles, originals] = await Promise.all([
    ctx.sql<{ id: string; name: string }[]>`select id, name from toph.fields where farm_id = ${ctx.farmId} order by name`,
    ctx.sql<{ employee_id: string; avatar_url: string | null; default_field: string; default_activity: string }[]>`select employee_id, avatar_url, default_field, default_activity from toph.mobile_profiles where farm_id = ${ctx.farmId}`,
    ctx.sql<{ id: string; avatar_path: string | null }[]>`select id, avatar_path from toph.employees where farm_id = ${ctx.farmId}`,
  ]);
  const accounts: MobileAccount[] = workspace.data.employees.filter(person => person.status === "Active").map(person => {
    const profile = profiles.find(item => item.employee_id === person.id);
    return { id: person.id, name: person.name, role: person.role, email: person.email, phone: person.phone,
      avatarUrl: profile ? profile.avatar_url : originals.find(item => item.id === person.id)?.avatar_path ?? null,
      defaultField: fields.some(field => field.name === profile?.default_field) ? profile!.default_field : fields[0]?.name ?? "",
      defaultActivity: profile?.default_activity ?? "Spraying" };
  });
  return { mode: "shared", farm: { id: ctx.farmId, name: workspace.data.settings.farmName, timezone: ctx.farm.timezone }, accounts, fields, revision: workspace.revision, maxAudioBytes: MAX_MOBILE_AUDIO_BYTES };
}

export async function updateMobileAccount(ctx: FarmContext, accountId: string, body: unknown): Promise<MobileBootstrap> {
  const id = parseUuid(accountId, "accountId");
  const { expectedRevision, profile } = parseAccountEdit(body);
  const normalized = normalizeAccountName(profile.name);
  profile.name = normalized.name;
  await getWorkspace(ctx);
  try { await ctx.sql.begin(async tx => {
    const [row] = await tx`select payload, revision from toph.workspace_state where farm_id = ${ctx.farmId} for update`;
    if (row.revision !== expectedRevision) throw new ApiError(409, "REVISION_CONFLICT", "The account changed elsewhere. Reload accounts and try again.");
    const state = parseWorkspaceState(typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload);
    const employee = state.employees.find(person => person.id === id && person.status === "Active");
    if (!employee) throw notFound("This account is no longer available.");
    const fields = await tx`select id, name from toph.fields where farm_id = ${ctx.farmId}`;
    if (fields.length ? !fields.some(field => field.name === profile.defaultField) : profile.defaultField !== "") throw validationError("Choose a field from this farm.");
    await tx`update toph.accounts set name = ${normalized.name}, normalized_name = ${normalized.normalizedName} where farm_id = ${ctx.farmId} and employee_id = ${id}`;
    Object.assign(employee, { name: profile.name, role: profile.role, email: profile.email, phone: profile.phone });
    await tx`insert into toph.mobile_profiles (farm_id, employee_id, avatar_url, default_field, default_activity)
      values (${ctx.farmId}, ${id}, ${profile.avatarUrl}, ${profile.defaultField}, ${profile.defaultActivity})
      on conflict (farm_id, employee_id) do update set avatar_url = excluded.avatar_url, default_field = excluded.default_field, default_activity = excluded.default_activity`;
    // Roster is authoritative for web contact details; the normalized row supplies log avatars/names.
    await tx`update toph.employees set display_name = ${profile.name}, avatar_path = ${profile.avatarUrl}, updated_at = now() where farm_id = ${ctx.farmId} and id = ${id}`;
    await tx`update toph.workspace_state set payload = ${JSON.stringify(state)}::jsonb, revision = revision + 1, updated_at = now() where farm_id = ${ctx.farmId}`;
  }); } catch (error) { nameTaken(error); }
  return getMobileBootstrap(ctx);
}
