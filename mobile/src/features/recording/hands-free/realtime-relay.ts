/**
 * Relay between the OpenAI Realtime data channel and the Toph server (docs/backend/voice.md,
 * "What the mobile client must do"). Pure: the data channel, network and save path are supplied
 * by the caller. The server stays the validator; the model's arguments are never saved.
 */
import type { ExtractedLogFields } from "@toph/contracts/transcription";
import type { VoiceCheckResult, VoiceStateResult } from "@toph/contracts/voice";
import type { HandsFreePhase } from "./machine";

export type RelayTranscripts = {
  /** "Assistant: …" / "Worker: …" lines in conversation order, so short answers keep their question. */
  labelled: string;
  /** Only what the worker said; this is what the log stores. */
  worker: string;
};
/** "confirmed": the worker approved the read-back; the caller hangs up at once and saves after the call. */
export type RelayEnd = "confirmed" | "failed" | "limit";
export type RelayDeps = {
  send(event: Record<string, unknown>): void;
  postState(transcript: string, turn: number): Promise<VoiceStateResult<ExtractedLogFields>>;
  postCheck(args: unknown): Promise<VoiceCheckResult<ExtractedLogFields>>;
  onPhase(phase: Extract<HandsFreePhase, "listening" | "thinking" | "speaking">, text?: string): void;
  /** The newest server-validated fields, kept for the review form. */
  onFields(fields: ExtractedLogFields): void;
  /** The caller hangs up. "confirmed" saves, "failed" continues in turn-based mode, "limit" opens the review form. */
  onEnd(reason: RelayEnd, message?: string): void;
  toolName: string;
  /** Worker turns before the call is ended; a realtime call is billed while it is open. */
  maxTurns?: number;
};

type Line = { id: string; role: "assistant" | "worker"; text: string };
type FunctionCall = { type?: string; name?: string; call_id?: string; arguments?: unknown };
/** The parts of the server events this relay reads; everything else is ignored. */
type RealtimeEvent = {
  type?: string; item_id?: string; transcript?: string;
  item?: { id?: string; type?: string; role?: string };
  response?: { status?: string; status_details?: { error?: { message?: string } }; output?: FunctionCall[] };
  error?: { code?: string; message?: string };
};
// A response.create that collides with the server's own voice-activity response is harmless.
const harmlessErrors = new Set(["conversation_already_has_active_response", "response_cancel_not_active"]);

export function createRealtimeRelay(deps: RelayDeps) {
  const maxTurns = deps.maxTurns ?? 14;
  const lines: Line[] = [];
  const handled = new Set<string>();
  let turn = 0, injected = -1, opened = false, closed = false, working = 0;
  let calls: Promise<void> = Promise.resolve();

  const text = (role?: Line["role"]) => lines.filter(line => line.text && (!role || line.role === role));
  const transcripts = (): RelayTranscripts => ({
    labelled: text().map(line => `${line.role === "assistant" ? "Assistant" : "Worker"}: ${line.text}`).join("\n"),
    worker: text("worker").map(line => line.text).join("\n\n"),
  });
  function end(reason: RelayEnd, message?: string) {
    if (closed) return;
    closed = true;
    deps.onEnd(reason, message);
  }
  /** Items are placed when the conversation adds them; their transcripts arrive later and out of order. */
  function place(id: string, role: Line["role"]) {
    let line = lines.find(item => item.id === id);
    if (!line) { line = { id, role, text: "" }; lines.push(line); }
    return line;
  }

  function workerSpoke(id: string, spokenText: string) {
    const said = spokenText.trim();
    if (!said) return;
    place(id, "worker").text = said;
    turn += 1;
    if (turn > maxTurns) { end("limit"); return; }
    const sent = turn;
    deps.postState(transcripts().labelled, sent).then(result => {
      // A slower, older extraction must not overwrite a newer note.
      if (closed || result.turn < injected) return;
      injected = result.turn;
      deps.onFields(result.fields);
      deps.send({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: result.stateNote }] } });
      // No response.create: the note is context, and creating an item never starts a response.
    }).catch(() => undefined); // EXTRACTION_FAILED or a rate limit: skip this turn.
  }

  async function answer(call: FunctionCall): Promise<boolean> {
    const output = (value: unknown) => deps.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(value) } });
    const check = await deps.postCheck(call.arguments);
    if (closed) return false;
    if (check.fields) deps.onFields(check.fields);
    if (!check.saveRequested) {
      // Notes are the longest value and the model does not need them back.
      output({ ...check, fields: check.fields ? { ...check.fields, notes: undefined } : null });
      return true;
    }
    // Nothing more needs saying: waiting for a spoken goodbye only keeps the worker on the phone.
    end("confirmed");
    return false;
  }

  function functionCalls(response: RealtimeEvent["response"]) {
    const fresh = (response?.output ?? []).filter(item => item.type === "function_call" && item.name === deps.toolName && item.call_id && !handled.has(item.call_id));
    if (!fresh.length) return false;
    for (const call of fresh) handled.add(call.call_id!);
    working += 1;
    deps.onPhase("thinking");
    calls = calls.then(async () => {
      let replied = false;
      for (const call of fresh) replied = (await answer(call)) || replied;
      if (closed || !replied) return;
      deps.send({ type: "response.create" });
    }).catch(cause => end("failed", cause instanceof Error ? cause.message : "")).finally(() => { working -= 1; });
    return true;
  }

  return {
    transcripts,
    turn: () => turn,
    /**
     * The data channel opened. No greeting is requested: composing and speaking one costs a full model
     * turn before the worker may say anything, and semantic VAD answers whatever they open with anyway.
     */
    open() {
      if (opened || closed) return;
      opened = true;
      deps.onPhase("listening");
    },
    /** One data-channel message, as the JSON string or the parsed event. */
    handle(message: unknown) {
      if (closed) return;
      let event: RealtimeEvent | null = null;
      try { event = (typeof message === "string" ? JSON.parse(message) : message) as RealtimeEvent | null; } catch { return; }
      if (!event || typeof event.type !== "string") return;
      switch (event.type) {
        case "conversation.item.added":
        case "conversation.item.created": {
          const item = event.item;
          if (item?.type === "message" && typeof item.id === "string" && (item.role === "user" || item.role === "assistant")) place(item.id, item.role === "user" ? "worker" : "assistant");
          break;
        }
        case "conversation.item.input_audio_transcription.completed":
          if (typeof event.transcript === "string") workerSpoke(String(event.item_id ?? `worker-${lines.length}`), event.transcript);
          break;
        case "response.output_audio_transcript.done":
        case "response.audio_transcript.done":
          if (typeof event.transcript === "string" && event.transcript.trim()) place(String(event.item_id ?? `assistant-${lines.length}`), "assistant").text = event.transcript.trim();
          break;
        case "input_audio_buffer.speech_started": deps.onPhase("listening"); break;
        // speech_stopped is deliberately not a phase. Nothing computes between the end of a sentence and
        // the reply, the microphone stays open for a barge-in, and labelling the gap "Thinking" reads as stuck.
        case "output_audio_buffer.started": deps.onPhase("speaking"); break;
        case "response.output_audio_transcript.delta":
        case "response.audio_transcript.delta": deps.onPhase("speaking"); break;
        case "output_audio_buffer.stopped":
        case "output_audio_buffer.cleared":
          if (!working) deps.onPhase("listening");
          break;
        case "response.done":
          if (event.response?.status === "failed") { end("failed", event.response?.status_details?.error?.message); break; }
          functionCalls(event.response);
          break;
        case "error":
          if (!harmlessErrors.has(event.error?.code ?? "")) end("failed", typeof event.error?.message === "string" ? event.error.message : "");
          break;
      }
    },
    /** Stops relaying; late server replies are ignored. */
    close() { closed = true; },
  };
}
