import type { Message } from "./workspace";

/** A conversation is between the farm administrator and one worker. */
export type MessageInbox = { messages: Message[]; revision: number };
export type MessagesResponse = { data: MessageInbox };
/** Reuse id when retrying an uncertain send. Sender and timestamp come from the server. */
export type SendMessageRequest = { id: string; employeeId: string; body: string };
export type ReadMessagesRequest = { employeeId: string; messageIds: string[] };
export const MESSAGE_POLL_MS = 5_000;
