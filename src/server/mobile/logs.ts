import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { MobileLogReceipt, MobileLogSubmission, MobileRemoteLog } from "@/contracts/mobile";
import type { FarmContext } from "@/server/farm-context";
import { ApiError, notFound, payloadTooLarge, validationError } from "@/server/errors";
import { getWorkspace } from "@/server/workspace/service";
import { parseWorkspaceState } from "@/server/workspace/validation";
import { isValidCalendarDate, localDateTimeToInstant } from "@/server/time/zoned";
import { normalizeTagLabel } from "@/server/validation/tag-label";
import { parseUuid } from "@/server/validation/ids";
import { toLogDto } from "@/server/services/dashboard";
import { dashboardLogs } from "@/server/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { MAX_MOBILE_AUDIO_BYTES } from "./accounts";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const text = (max: number) => z.string().trim().max(max);
const metadataSchema = z.object({
  contractVersion: z.enum(["1", "demo-1"]).transform(() => "1" as const), clientDraftId: z.string().uuid(), accountId: z.string().uuid(), fieldId: z.string().uuid(),
  activity: text(80).min(1), workDate: z.string().refine(isValidCalendarDate), startTime: time, endTime: time,
  notes: text(16_000), transcript: text(40_000).nullable(),
  treatment: z.object({ product: text(200).nullable(), amount: z.number().positive().max(1e9).nullable(), unit: text(40).nullable() }).strict().nullable(),
  tags: z.array(text(40).min(1)).max(10),
  recordings: z.array(z.object({ mimeType: z.enum(["audio/mp4", "audio/m4a", "audio/x-m4a", "audio/mpeg", "audio/wav", "audio/webm"]), durationSeconds: z.number().positive().max(1800) }).strict()).max(8),
}).strict();
export function parseMobileSubmission(value: unknown): MobileLogSubmission {
  const result = metadataSchema.safeParse(value);
  if (!result.success) throw validationError("Check the log details.");
  const data = result.data;
  if (data.endTime <= data.startTime || (!data.notes && !data.recordings.length)) throw validationError("Add a note or recording, and an end time after the start time.");
  if (data.treatment?.amount && !data.treatment.unit) throw validationError("Choose a treatment unit.");
  return { ...data, clientDraftId: data.clientDraftId.toLowerCase(), accountId: data.accountId.toLowerCase(), fieldId: data.fieldId.toLowerCase(), tags: [...new Set(data.tags)] };
}

export type UploadedClip = { bytes: Buffer; mimeType: string; durationSeconds: number };
export async function readMobileSubmission(request: Request): Promise<{ metadata: MobileLogSubmission; clips: UploadedClip[] }> {
  const limit = MAX_MOBILE_AUDIO_BYTES + 120_000;
  if (!/^multipart\/form-data\s*;/i.test(request.headers.get("content-type") ?? "")) throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Send log metadata and recording files as multipart form data.");
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw payloadTooLarge(limit);
  if (!request.body) throw validationError("Add a log to save.");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const reader = request.body.getReader();
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw payloadTooLarge(limit); }
      chunks.push(new Uint8Array(value));
    }
  } finally { reader.releaseLock(); }
  let form: FormData;
  try { form = await new Response(new Blob(chunks), { headers: { "Content-Type": request.headers.get("content-type")! } }).formData(); }
  catch { throw validationError("The upload could not be read."); }
  let metadata: MobileLogSubmission;
  try {
    if (typeof form.get("metadata") !== "string" || form.getAll("metadata").length !== 1) throw new Error();
    metadata = parseMobileSubmission(JSON.parse(form.get("metadata") as string));
  } catch (error) { if (error instanceof ApiError) throw error; throw validationError("Log metadata is invalid."); }
  if (request.headers.get("idempotency-key") !== metadata.clientDraftId) throw validationError("The submission key must match this draft.");
  if ([...form.keys()].some(key => key !== "metadata" && !/^audio[0-7]$/.test(key)) || [...form.keys()].length !== metadata.recordings.length + 1) throw validationError("Include exactly the recording clips in the log.");
  let audioBytes = 0;
  const clips: UploadedClip[] = [];
  for (let index = 0; index < metadata.recordings.length; index++) {
    const file = form.get(`audio${index}`);
    const spec = metadata.recordings[index];
    if (!(file instanceof File) || !file.size || file.type !== spec.mimeType || form.getAll(`audio${index}`).length !== 1) throw validationError("A recording clip is missing or has the wrong format.");
    const bytes = Buffer.from(await file.arrayBuffer());
    audioBytes += bytes.length;
    if (audioBytes > MAX_MOBILE_AUDIO_BYTES) throw payloadTooLarge(MAX_MOBILE_AUDIO_BYTES);
    const mime = spec.mimeType;
    const valid = ["audio/mp4", "audio/m4a", "audio/x-m4a"].includes(mime) ? bytes.toString("ascii", 4, 8) === "ftyp" :
      mime === "audio/mpeg" ? bytes.toString("ascii", 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) :
      mime === "audio/wav" ? bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE" :
      bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    if (!valid) throw validationError("The recording contents do not match its audio format.");
    clips.push({ bytes, ...spec });
  }
  return { metadata, clips };
}

function workInstant(date: string, time: string, zone: string): Date {
  try {
    const instant = localDateTimeToInstant(date, time, zone);
    // Reject both occurrences of a repeated wall clock hour instead of guessing.
    const display = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    if ([-120, -60, -30, 30, 60, 120].some(minutes => display.format(new Date(instant.getTime() + minutes * 60_000)) === display.format(instant))) throw new Error();
    return instant;
  } catch { throw validationError("Choose work times that exist unambiguously in the farm timezone."); }
}

export async function saveMobileLog(ctx: FarmContext, metadata: MobileLogSubmission, clips: UploadedClip[]): Promise<MobileLogReceipt> {
  const start = workInstant(metadata.workDate, metadata.startTime, ctx.farm.timezone);
  const end = workInstant(metadata.workDate, metadata.endTime, ctx.farm.timezone);
  const hashFor = (contractVersion: string) => {
    const hash = createHash("sha256").update(JSON.stringify({ ...metadata, contractVersion }));
    for (const clip of clips) hash.update(clip.bytes);
    return hash.digest("hex");
  };
  const contentHash = hashFor("1");
  await getWorkspace(ctx);
  return ctx.sql.begin(async tx => {
    // The farm lock serializes quota checks, profile archiving, and duplicate submissions.
    const [workspace] = await tx`select payload from toph.workspace_state where farm_id = ${ctx.farmId} for update`;
    const state = parseWorkspaceState(typeof workspace.payload === "string" ? JSON.parse(workspace.payload) : workspace.payload);
    const employee = state.employees.find(person => person.id === metadata.accountId && person.status === "Active");
    if (!employee) throw notFound("Choose an active account from this farm.");
    const [existing] = await tx`select log_id, content_hash, saved_at from toph.mobile_submissions where farm_id = ${ctx.farmId} and employee_id = ${employee.id} and client_draft_id = ${metadata.clientDraftId}`;
    if (existing) {
      if (existing.content_hash !== contentHash && existing.content_hash !== hashFor("demo-1")) throw new ApiError(409, "REVISION_CONFLICT", "This draft is already on the server with different details. Keep this copy and create a new log for changes.");
      return { clientDraftId: metadata.clientDraftId, logId: existing.log_id as string, savedAt: new Date(existing.saved_at).toISOString() };
    }
    const fields = await tx`select id from toph.fields where farm_id = ${ctx.farmId} and id = ${metadata.fieldId}`;
    if (!fields.length) throw validationError("Choose a field from this farm.");
    const [usage] = await tx`select coalesce(sum(octet_length(bytes)),0)::int as bytes from toph.mobile_recordings where farm_id = ${ctx.farmId}`;
    if (usage.bytes + clips.reduce((sum, clip) => sum + clip.bytes.length, 0) > 100_000_000) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Recording storage is full. Your draft is safe on this device.");
    const [count] = await tx`select count(*)::int as count from toph.mobile_submissions where farm_id = ${ctx.farmId}`;
    if (count.count >= 1000) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "The recording log limit has been reached. Your draft is safe on this device.");
    // Workspace-created employees become normalized records before the log FK is written.
    const [profile] = await tx`select avatar_url from toph.mobile_profiles where farm_id = ${ctx.farmId} and employee_id = ${employee.id}`;
    await tx`insert into toph.employees (id, farm_id, display_name, avatar_path) values (${employee.id}, ${ctx.farmId}, ${employee.name}, ${profile?.avatar_url ?? null}) on conflict (id) do nothing`;
    const logId = randomUUID();
    const clipIds = clips.map(() => randomUUID());
    const recordingPath = clipIds.length ? `/api/mobile/v1/recordings/${clipIds[0]}` : null;
    const treatmentSummary = metadata.treatment ? [metadata.treatment.product, metadata.treatment.amount, metadata.treatment.unit].filter(value => value !== null && value !== "").join(" ") : "";
    const summary = [metadata.notes || metadata.transcript || "Voice recording", treatmentSummary ? `Treatment: ${treatmentSummary}` : ""].filter(Boolean).join("\n\n");
    await tx`insert into toph.work_logs (id, farm_id, employee_id, field_id, activity, work_date, start_at, end_at, summary, transcript, is_new, recording_path, recording_duration_seconds)
      values (${logId}, ${ctx.farmId}, ${employee.id}, ${metadata.fieldId}, ${metadata.activity}, ${metadata.workDate}, ${start.toISOString()}, ${end.toISOString()}, ${summary}, ${metadata.transcript}, true, ${recordingPath}, ${clips.length ? clips.reduce((sum, clip) => sum + clip.durationSeconds, 0) : null})`;
    for (let index = 0; index < clips.length; index++) {
      const clip = clips[index];
      await tx`insert into toph.mobile_recordings (id, farm_id, log_id, position, mime_type, duration_seconds, bytes)
        values (${clipIds[index]}, ${ctx.farmId}, ${logId}, ${index}, ${clip.mimeType}, ${clip.durationSeconds}, ${clip.bytes})`;
    }
    for (const label of metadata.tags) {
      const normalized = normalizeTagLabel(label);
      await tx`insert into toph.tags (id, farm_id, label, normalized_label) values (${randomUUID()}, ${ctx.farmId}, ${normalized.label}, ${normalized.normalizedLabel})
        on conflict (farm_id, normalized_label) do nothing`;
      const [tag] = await tx`select id from toph.tags where farm_id = ${ctx.farmId} and normalized_label = ${normalized.normalizedLabel}`;
      await tx`insert into toph.work_log_tags (farm_id, work_log_id, tag_id) values (${ctx.farmId}, ${logId}, ${tag.id}) on conflict do nothing`;
    }
    const [receipt] = await tx`insert into toph.mobile_submissions (farm_id, employee_id, client_draft_id, log_id, content_hash, notes, treatment)
      values (${ctx.farmId}, ${employee.id}, ${metadata.clientDraftId}, ${logId}, ${contentHash}, ${metadata.notes}, ${metadata.treatment ? JSON.stringify(metadata.treatment) : null}::jsonb) returning saved_at`;
    return { clientDraftId: metadata.clientDraftId, logId, savedAt: new Date(receipt.saved_at).toISOString() };
  });
}

export async function listMobileLogs(ctx: FarmContext, accountId: string): Promise<MobileRemoteLog[]> {
  const id = parseUuid(accountId, "accountId");
  const workspace = await getWorkspace(ctx);
  if (!workspace.data.employees.some(person => person.id === id && person.status === "Active")) throw notFound("This account is no longer available.");
  const rows = await ctx.db.select().from(dashboardLogs).where(and(eq(dashboardLogs.farmId, ctx.farmId), eq(dashboardLogs.employeeId, id))).orderBy(desc(dashboardLogs.workDate), desc(dashboardLogs.createdAt)).limit(100);
  if (!rows.length) return [];
  const ids = rows.map(row => row.id);
  const [submissions, clips, transcripts] = await Promise.all([
    ctx.sql`select log_id, client_draft_id, notes, treatment from toph.mobile_submissions where farm_id = ${ctx.farmId} and log_id = any(${ids}::uuid[])`,
    ctx.sql`select id, log_id, duration_seconds, mime_type from toph.mobile_recordings where farm_id = ${ctx.farmId} and log_id = any(${ids}::uuid[]) order by position`,
    ctx.sql`select id, transcript from toph.work_logs where farm_id = ${ctx.farmId} and id = any(${ids}::uuid[])`,
  ]);
  return rows.map(row => {
    const submission = submissions.find(item => item.log_id === row.id);
    return { ...toLogDto(row), clientDraftId: submission?.client_draft_id ?? null, notes: submission?.notes ?? row.summary,
      treatment: typeof submission?.treatment === "string" ? JSON.parse(submission.treatment) : submission?.treatment ?? null,
      transcript: transcripts.find(item => item.id === row.id)?.transcript ?? null,
      clips: clips.filter(item => item.log_id === row.id).map(item => ({ url: `/api/mobile/v1/recordings/${item.id}`, durationSeconds: Number(item.duration_seconds), mimeType: item.mime_type })) };
  });
}
