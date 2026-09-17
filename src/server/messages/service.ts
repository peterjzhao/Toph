import "server-only";
import { z } from "zod";
import type { MessageInbox } from "@/contracts/messages";
import type { WorkspaceResponse } from "@/contracts/workspace";
import type { AccountContext } from "@/server/accounts/service";
import { ApiError, forbidden, notFound, validationError } from "@/server/errors";
import { changeWorkspaceMessages, getWorkspace } from "@/server/workspace/service";

const id = z.string().uuid().transform(value => value.toLowerCase());
const sendSchema = z.object({ id, employeeId: id, body: z.string().trim().min(1).max(4000) }).strict();
const readSchema = z.object({ employeeId: id, messageIds: z.array(id).min(1).max(2000) }).strict();
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw validationError("Invalid message request.", Object.fromEntries(result.error.issues.map(issue => [issue.path.join(".") || "body", issue.message])));
  return result.data;
}
function assertConversation(ctx: AccountContext, employeeId: string) {
  if (ctx.account.role === "worker" && ctx.account.employeeId !== employeeId) throw forbidden("This conversation belongs to another worker.");
}
function inbox(ctx: AccountContext, state: WorkspaceResponse): MessageInbox {
  return { revision: state.revision, messages: state.data.messages.filter(message => ctx.account.role === "admin" || message.employeeId === ctx.account.employeeId) };
}
export async function getMessages(ctx: AccountContext): Promise<MessageInbox> {
  return inbox(ctx, await getWorkspace(ctx));
}
export async function sendMessage(ctx: AccountContext, body: unknown): Promise<MessageInbox> {
  const input = parse(sendSchema, body);
  assertConversation(ctx, input.employeeId);
  const from = ctx.account.role === "admin" ? "admin" : "employee";
  const result = await changeWorkspaceMessages(ctx, async (messages, tx) => {
    const existing = messages.find(message => message.id === input.id);
    if (existing) {
      if (existing.employeeId !== input.employeeId || existing.from !== from || existing.body !== input.body) {
        throw new ApiError(409, "MESSAGE_CONFLICT", "This send was already used for a different message.");
      }
      return messages;
    }
    const [worker] = await tx`select a.id from toph.accounts a join toph.employees e on e.id = a.employee_id and e.farm_id = a.farm_id
      where a.farm_id = ${ctx.farmId} and a.employee_id = ${input.employeeId} and a.role = 'worker' and a.is_active and e.is_active`;
    if (!worker) throw notFound("Active worker");
    if (messages.length >= 2000) throw validationError("This farm has reached its limit of 2,000 messages. Your message has not been sent.");
    return [...messages, { ...input, from, createdAt: new Date().toISOString(), read: false }];
  });
  return inbox(ctx, result);
}
export async function readMessages(ctx: AccountContext, body: unknown): Promise<MessageInbox> {
  const input = parse(readSchema, body);
  assertConversation(ctx, input.employeeId);
  const incoming = ctx.account.role === "admin" ? "employee" : "admin";
  const ids = new Set(input.messageIds);
  const result = await changeWorkspaceMessages(ctx, async messages => {
    const targets = messages.filter(message => ids.has(message.id));
    if (targets.length !== ids.size || targets.some(message => message.employeeId !== input.employeeId || message.from !== incoming)) {
      throw validationError("Only received messages in this conversation can be marked read.");
    }
    if (targets.every(message => message.read)) return messages;
    return messages.map(message => ids.has(message.id) ? { ...message, read: true } : message);
  });
  return inbox(ctx, result);
}
