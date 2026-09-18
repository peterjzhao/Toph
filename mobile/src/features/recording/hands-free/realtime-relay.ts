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
/** "confirmed": the worker approved the read-back; the caller saves, and hangs up once the model has finished its sentence. */
export type RelayEnd = "confirmed" | "failed" | "limit";
export type RelayDeps = {
  send(event: Record<string, unknown>): void;
  postState(transcript: string, turn: number): Promise<VoiceStateResult<ExtractedLogFields>>;
  postCheck(args: unknown): Promise<VoiceCheckResult<ExtractedLogFields>>;
  onPhase(phase: Extract<HandsFreePhase, "listening" | "thinking" | "speaking">, text?: string): void;
  /** The newest server-validated fields, kept for the review form. */
  onFields(fields: ExtractedLogFields): void;
  /** Whether the strict extraction of everything said so far has every required detail; the screen then offers a tap to save. */
  onReady(ready: boolean): void;
  /** The caller hangs up. "confirmed" saves, "failed" continues in turn-based mode, "limit" opens the review form. */
  onEnd(reason: RelayEnd, message?: string): void;
  toolName: string;
  /** Worker turns before the call is ended; a realtime call is billed while it is open. */
  maxTurns?: number;
  /** Silence after the call opens before the model asks the worker to start. */
  greetAfterMs?: number;
};

/** Spoken only when the worker has not started talking shortly after the call opens. */
export const greetingPrompt = "Tell me what you worked on.";
const greeting = { type: "response.create", response: { instructions: `Say exactly this, and nothing else: "${greetingPrompt}"` } };
/** Marks a turn's audio request, so an error about it is told apart from one that ends the call. */
const retrievePrefix = "retrieve-";

type Line = {
  id: string; role: "assistant" | "worker"; text: string;
  /** The worker turn's transcription has arrived, even if it was empty. */
  heard?: boolean;
  /** The worker turn's audio as base64 PCM16; null when it could not be fetched. */
  audio?: string | null;
};
type FunctionCall = { type?: string; name?: string; call_id?: string; arguments?: unknown };
type ContentPart = { type?: string; audio?: unknown };
/** The parts of the server events this relay reads; everything else is ignored. */
type RealtimeEvent = {
  type?: string; item_id?: string; transcript?: string;
  item?: { id?: string; type?: string; role?: string; content?: ContentPart[] };
  response?: { status?: string; status_details?: { error?: { message?: string } }; output?: FunctionCall[] };
  error?: { code?: string; message?: string; event_id?: string };
};
// A response.create that collides with the server's own voice-activity response is harmless.
const harmlessErrors = new Set(["conversation_already_has_active_response", "response_cancel_not_active"]);

export function createRealtimeRelay(deps: RelayDeps) {
  const maxTurns = deps.maxTurns ?? 14;
  const lines: Line[] = [];
  const handled = new Set<string>();
  const requested = new Set<string>();
  let turn = 0, injected = -1, opened = false, working = 0;
  /** `ended`: nothing more is relayed. `closed`: the call itself is gone. */
  let ended = false, closed = false;
  /** The worker has spoken, or the model has already started a reply: no prompt is needed. */
  let conversing = false, speaking = false;
  let greetTimer: ReturnType<typeof setTimeout> | null = null;
  let calls: Promise<void> = Promise.resolve();
  const quietWaiters: (() => void)[] = [];
  const audioWaiters: (() => void)[] = [];

  const text = (role?: Line["role"]) => lines.filter(line => line.text && (!role || line.role === role));
  const transcripts = (): RelayTranscripts => ({
    labelled: text().map(line => `${line.role === "assistant" ? "Assistant" : "Worker"}: ${line.text}`).join("\n"),
    worker: text("worker").map(line => line.text).join("\n\n"),
  });
  /** The worker's turns with audio, in conversation order. A turn transcribed as nothing was noise, not speech. */
  const recorded = () => lines.filter(line => line.role === "worker" && typeof line.audio === "string" && (line.text || !line.heard)).map(line => line.audio as string);
  const waitingForAudio = () => lines.some(line => requested.has(line.id) && line.audio === undefined);
  const settle = (waiters: (() => void)[]) => waiters.splice(0).forEach(resolve => resolve());
  function stopGreeting() {
    if (greetTimer) clearTimeout(greetTimer);
    greetTimer = null;
  }
  function end(reason: RelayEnd, message?: string) {
    if (ended) return;
    ended = true;
    stopGreeting();
    deps.onEnd(reason, message);
  }
  /** Items are placed when the conversation adds them; their transcripts arrive later and out of order. */
  function place(id: string, role: Line["role"]) {
    let line = lines.find(item => item.id === id);
    if (!line) { line = { id, role, text: "" }; lines.push(line); }
    return line;
  }

  function workerSpoke(id: string, spokenText: string) {
    const line = place(id, "worker");
    line.heard = true;
    const said = spokenText.trim();
    if (!said) return;
    line.text = said;
    conversing = true;
    turn += 1;
    if (turn > maxTurns) { end("limit"); return; }
    const sent = turn;
    deps.postState(transcripts().labelled, sent).then(result => {
      // A slower, older extraction must not overwrite a newer note.
      if (ended || result.turn < injected) return;
      injected = result.turn;
      deps.onFields(result.fields);
      deps.onReady(result.status === "ready_to_confirm");
      deps.send({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: result.stateNote }] } });
      // No response.create: the note is context, and creating an item never starts a response.
    }).catch(() => undefined); // EXTRACTION_FAILED or a rate limit: skip this turn.
  }

  /**
   * A finished turn's audio is fetched straight away, before the model's reply starts playing on the same
   * connection. It arrives as one data-channel message; see `allowLargeMessages` in webrtc-adapter.ts.
   */
  function fetchAudio(id: string) {
    if (requested.has(id)) return;
    requested.add(id);
    place(id, "worker");
    deps.send({ type: "conversation.item.retrieve", item_id: id, event_id: `${retrievePrefix}${id}` });
  }
  function storeAudio(id: string, audio: string | null) {
    const line = lines.find(item => item.id === id);
    if (!line || !requested.has(id)) return;
    // A late arrival still counts, even after a wait gave up on it.
    if (audio !== null || line.audio === undefined) line.audio = audio;
    if (!waitingForAudio()) settle(audioWaiters);
  }

  async function answer(call: FunctionCall): Promise<boolean> {
    const output = (value: unknown) => deps.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(value) } });
    const check = await deps.postCheck(call.arguments);
    if (ended) return false;
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
      if (ended || !replied) return;
      deps.send({ type: "response.create" });
    }).catch(cause => end("failed", cause instanceof Error ? cause.message : "")).finally(() => { working -= 1; });
    return true;
  }

  return {
    transcripts,
    turn: () => turn,
    /**
     * The data channel opened. No greeting is requested up front: composing and speaking one costs a full
     * model turn before the worker may say anything, and semantic VAD answers whatever they open with anyway.
     * A worker who stays silent is prompted after `greetAfterMs`.
     */
    open() {
      if (opened || ended) return;
      opened = true;
      deps.onPhase("listening");
      if (conversing) return;
      greetTimer = setTimeout(() => {
        greetTimer = null;
        if (!ended && !conversing) deps.send(greeting);
      }, deps.greetAfterMs ?? 2000);
    },
    /** One data-channel message, as the JSON string or the parsed event. */
    handle(message: unknown) {
      if (closed) return;
      let event: RealtimeEvent | null = null;
      try { event = (typeof message === "string" ? JSON.parse(message) : message) as RealtimeEvent | null; } catch { return; }
      if (!event || typeof event.type !== "string") return;
      // Followed after the end too: the caller hangs up once the model's last words have played and the
      // turns' audio is in.
      switch (event.type) {
        case "output_audio_buffer.started": speaking = true; break;
        case "output_audio_buffer.stopped":
        case "output_audio_buffer.cleared": speaking = false; settle(quietWaiters); break;
        case "conversation.item.retrieved": {
          const audio = event.item?.content?.find(part => part.type === "input_audio")?.audio;
          if (typeof event.item?.id === "string") storeAudio(event.item.id, typeof audio === "string" && audio ? audio : null);
          return;
        }
        case "error":
          // A turn whose audio cannot be fetched is left out of the recording; the call goes on.
          if (event.error?.event_id?.startsWith(retrievePrefix)) { storeAudio(event.error.event_id.slice(retrievePrefix.length), null); return; }
          break;
      }
      if (ended) return;
      switch (event.type) {
        case "conversation.item.added":
        case "conversation.item.created": {
          const item = event.item;
          if (item?.type === "message" && typeof item.id === "string" && (item.role === "user" || item.role === "assistant")) place(item.id, item.role === "user" ? "worker" : "assistant");
          break;
        }
        case "input_audio_buffer.committed":
          if (typeof event.item_id === "string") fetchAudio(event.item_id);
          break;
        case "conversation.item.input_audio_transcription.completed":
          if (typeof event.transcript === "string") workerSpoke(String(event.item_id ?? `worker-${lines.length}`), event.transcript);
          break;
        case "response.output_audio_transcript.done":
        case "response.audio_transcript.done":
          if (typeof event.transcript === "string" && event.transcript.trim()) place(String(event.item_id ?? `assistant-${lines.length}`), "assistant").text = event.transcript.trim();
          break;
        case "input_audio_buffer.speech_started": conversing = true; stopGreeting(); deps.onPhase("listening"); break;
        case "response.created": conversing = true; stopGreeting(); break;
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
    /** Resolves once the model is not speaking: straight away when it is silent already, or the call is closed. */
    quiet(): Promise<void> {
      return closed || !speaking ? Promise.resolve() : new Promise(resolve => quietWaiters.push(resolve));
    },
    /** Stops the model mid-sentence: the worker tapped to save. */
    silence() {
      if (closed) return;
      deps.send({ type: "response.cancel" });
      deps.send({ type: "output_audio_buffer.clear" });
    },
    /** The worker's turns' audio received so far, in conversation order. */
    recorded,
    /** Waits up to `waitMs` for turns still being fetched; any still missing then are left out. */
    audio(waitMs = 4000): Promise<string[]> {
      if (closed || !waitingForAudio()) return Promise.resolve(recorded());
      return new Promise(resolve => {
        const timer = setTimeout(() => {
          for (const line of lines) if (requested.has(line.id) && line.audio === undefined) line.audio = null;
          settle(audioWaiters);
        }, waitMs);
        audioWaiters.push(() => { clearTimeout(timer); resolve(recorded()); });
      });
    },
    /** Stops relaying; late server replies are ignored, and anyone waiting is answered with what is here. */
    close() {
      ended = true; closed = true;
      stopGreeting();
      settle(quietWaiters);
      settle(audioWaiters);
    },
  };
}
