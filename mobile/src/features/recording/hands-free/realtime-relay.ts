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
export type RelaySaveResult = { saved: true; synced: boolean } | { saved: false; error: string; prompt?: string };
export type RelayEnd = "saved" | "failed" | "limit";
export type RelayDeps = {
  send(event: Record<string, unknown>): void;
  postState(transcript: string, turn: number): Promise<VoiceStateResult<ExtractedLogFields>>;
  postCheck(args: unknown): Promise<VoiceCheckResult<ExtractedLogFields>>;
  /** Final strict extraction of the transcript, then the review form's own save. */
  save(transcripts: RelayTranscripts): Promise<RelaySaveResult>;
  onPhase(phase: Extract<HandsFreePhase, "listening" | "thinking" | "speaking">, text?: string): void;
  /** The newest server-validated fields, kept for the review form. */
  onFields(fields: ExtractedLogFields): void;
  /** The caller hangs up. "failed" continues in turn-based mode; "limit" opens the review form. */
  onEnd(reason: RelayEnd, message?: string): void;
  toolName: string;
  /** Worker turns before the call is ended; a realtime call is billed while it is open. */
  maxTurns?: number;
  /** How long the spoken confirmation may take before hanging up anyway. */
  farewellMs?: number;
  schedule?: (run: () => void, ms: number) => unknown;
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
  const schedule = deps.schedule ?? ((run, ms) => setTimeout(run, ms));
  const lines: Line[] = [];
  const handled = new Set<string>();
  let turn = 0, injected = -1, opened = false, closed = false, farewell = false, farewellAudible = false, working = 0;
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
    const saved = await deps.save(transcripts());
    if (closed) return false;
    output(saved);
    farewell = saved.saved;
    return true;
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
      // The model now confirms aloud; hang up when it has finished, or soon after if no event says so.
      if (farewell) schedule(() => end("saved"), deps.farewellMs ?? 12_000);
    }).catch(cause => end("failed", cause instanceof Error ? cause.message : "")).finally(() => { working -= 1; });
    return true;
  }

  return {
    transcripts,
    turn: () => turn,
    /** The data channel opened: have the assistant greet the worker, once. */
    open() {
      if (opened || closed) return;
      opened = true;
      deps.send({ type: "response.create" });
      deps.onPhase("thinking");
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
        case "input_audio_buffer.speech_started": if (!farewell) deps.onPhase("listening"); break;
        case "input_audio_buffer.speech_stopped": if (!farewell) deps.onPhase("thinking"); break;
        case "output_audio_buffer.started": farewellAudible = farewell; deps.onPhase("speaking"); break;
        case "response.output_audio_transcript.delta":
        case "response.audio_transcript.delta": deps.onPhase("speaking"); break;
        case "output_audio_buffer.stopped":
        case "output_audio_buffer.cleared":
          // Audio that ended before the save belongs to an earlier sentence, not the confirmation.
          if (farewellAudible) end("saved");
          else if (!working && !farewell) deps.onPhase("listening");
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
