/**
 * Hands-free voice logging. One state machine, two transports: an OpenAI Realtime call over WebRTC
 * when the native module is in this build, and the turn-based record / speak loop otherwise or when
 * the call fails. Both end in the review form's own save; nothing here writes a log by itself.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import { AppState } from "react-native";
import type { ExtractedLogFields, TranscriptionResult } from "@toph/contracts/transcription";
import type { VoiceGuidance } from "@toph/contracts/voice";
import type { RecordingClip } from "../local-drafts";
import type { useRecorder } from "../use-recorder";
import { idleState, isLive, reduceHandsFree, type HandsFreePhase } from "./machine";
import { createRealtimeRelay, type RelayEnd, type RelaySaveResult, type RelayTranscripts } from "./realtime-relay";
import { createSilenceDetector, type SilenceOptions, type SilenceVerdict } from "./silence";
import type { Speaker } from "./speaker";
import { runTurnLoop, type SaveOutcome, type TurnLimits } from "./turn-loop";
import { exchangeSdp, type VoiceApi, type VoiceContext } from "./voice-api";
import type { ConnectRealtime, RealtimeCall } from "./webrtc-adapter";

type Recorder = Pick<ReturnType<typeof useRecorder>, "status" | "seconds" | "audio" | "error" | "start" | "finish" | "reset"> & { metering?: number | null };
/** Replaceable under test; the defaults are the native adapters. */
export type HandsFreeAdapters = {
  api: VoiceApi;
  speaker: Speaker;
  /** Null when `react-native-webrtc` is not in this build (Expo Go, web, Jest). */
  connect: ConnectRealtime | null;
  extract(transcript: string, context: VoiceContext): Promise<TranscriptionResult>;
  requestMicrophone(): Promise<boolean>;
  prepareCallAudio(): Promise<void>;
  haptic(phase: HandsFreePhase): void;
  keepAwake(on: boolean): void;
};
export type HandsFreeOptions = {
  context: VoiceContext;
  recorder: Recorder;
  /** Appends a clip to the log and returns the server's result, as the review form's recorder does. */
  appendClip(clip: RecordingClip): Promise<TranscriptionResult | null>;
  /** Replaces the log's clips and the speech that has no clip (a realtime conversation). */
  loadTranscript(clips: RecordingClip[], spoken?: string): void;
  applyFields(fields: ExtractedLogFields): void;
  /** The review form's Save log. */
  save(): Promise<SaveOutcome>;
  /** Starts an empty log before a session. */
  onReset(): void;
  /** Opens the review form with whatever has been filled in. */
  onReview(message?: string): void;
  adapters?: Partial<HandsFreeAdapters>;
  silence?: Partial<SilenceOptions>;
  limits?: Partial<TurnLimits>;
  /** How long the call may take to open before the turn-based mode takes over. */
  connectTimeoutMs?: number;
  savedBannerMs?: number;
};

type Run = { stopped: boolean; call: RealtimeCall | null; relay: ReturnType<typeof createRealtimeRelay> | null; timers: ReturnType<typeof setTimeout>[]; captured: boolean; fields: ExtractedLogFields | null };
type PendingClip = { resolve(clip: RecordingClip | null): void; reject(cause: Error): void; detector: ReturnType<typeof createSilenceDetector>; verdict: SilenceVerdict | null; recording: boolean };
let nativeAdapters: HandsFreeAdapters | null = null;
/** Required on first use: the audio, haptics and WebRTC modules are not needed to draw the switch. */
function defaultAdapters(): HandsFreeAdapters {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  nativeAdapters ??= (require("./native-adapters") as typeof import("./native-adapters")).createNativeAdapters();
  return nativeAdapters;
}

export function useHandsFree(options: HandsFreeOptions) {
  const latest = useRef(options); latest.current = options;
  const [state, dispatch] = useReducer(reduceHandsFree, idleState);
  const run = useRef<Run | null>(null);
  const pending = useRef<PendingClip | null>(null);
  const banner = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adapters = useCallback((): HandsFreeAdapters => {
    const given = latest.current.adapters ?? {};
    const complete = ["api", "speaker", "connect", "extract", "requestMicrophone", "prepareCallAudio", "haptic", "keepAwake"].every(key => key in given);
    return complete ? given as HandsFreeAdapters : { ...defaultAdapters(), ...given };
  }, []);

  /** Closes the call, the microphone and playback. Safe to call twice. */
  const release = useCallback((current: Run | null) => {
    if (!current || current.stopped) return;
    current.stopped = true;
    current.timers.forEach(clearTimeout);
    current.relay?.close();
    current.call?.close();
    const clip = pending.current; pending.current = null;
    if (clip) { latest.current.recorder.reset(); clip.resolve(null); }
    void adapters().speaker.stop();
    adapters().keepAwake(false);
  }, [adapters]);

  /** Ends the session. Anything already said is handed to the review form rather than dropped. */
  const finish = useCallback((current: Run, to: "saved" | "review" | "idle" | "error", message = "") => {
    if (current.stopped) return;
    const spoken = current.relay?.transcripts().worker ?? "";
    release(current);
    if (run.current === current) run.current = null;
    if (spoken && to !== "saved") { latest.current.loadTranscript([], spoken); if (current.fields) latest.current.applyFields(current.fields); }
    if (to === "saved") {
      dispatch({ type: "saved" });
      banner.current = setTimeout(() => dispatch({ type: "end" }), latest.current.savedBannerMs ?? 2500);
    } else if (to === "error") dispatch({ type: "fail", message });
    else {
      dispatch({ type: "end" });
      if (to === "review" || current.captured || spoken) latest.current.onReview(message);
    }
  }, [release]);

  // The recorder is a hook, so a clip is awaited by watching its status and input level.
  const recorder = options.recorder;
  useEffect(() => {
    const clip = pending.current;
    if (!clip) return;
    if (recorder.status === "recording") {
      clip.recording = true;
      if (clip.verdict) return;
      const verdict = clip.detector.push(recorder.metering ?? null, recorder.seconds * 1000);
      if (verdict !== "continue") { clip.verdict = verdict; void recorder.finish(); }
    } else if (recorder.status === "ready" && recorder.audio && clip.recording) {
      pending.current = null;
      clip.resolve(clip.verdict === "empty" ? null : { audio: recorder.audio, durationSeconds: recorder.seconds, transcript: "" });
    } else if (recorder.status === "idle" && recorder.error) {
      pending.current = null;
      clip.reject(new Error(recorder.error));
    }
  }, [recorder, recorder.status, recorder.seconds, recorder.metering, recorder.audio, recorder.error]);

  const recordClip = useCallback(() => new Promise<RecordingClip | null>((resolve, reject) => {
    pending.current = { resolve, reject, detector: createSilenceDetector(latest.current.silence), verdict: null, recording: false };
    void latest.current.recorder.start();
  }), []);

  const turns = useCallback(async (current: Run, guidance: VoiceGuidance | null) => {
    const { api, speaker } = adapters();
    dispatch({ type: "transport", transport: "turns" });
    const result = await runTurnLoop({
      record: recordClip,
      process: clip => { current.captured = true; return latest.current.appendClip(clip); },
      confirm: clip => api.confirm(clip.audio, latest.current.context),
      // Playback is stopped outright before the microphone opens, so the prompt is never transcribed.
      speak: async text => { await speaker.speak(text); await speaker.stop(); },
      save: () => latest.current.save(),
      onPhase: (phase, text) => dispatch({ type: phase, text }),
      stopped: () => current.stopped,
      limits: latest.current.limits,
    }, guidance);
    if (result.end === "stopped") return;
    finish(current, result.end === "saved" ? "saved" : result.end === "cancelled" && !current.captured ? "idle" : "review", result.message);
  }, [adapters, finish, recordClip]);

  /** The call could not start or dropped: continue by turns with what the worker already said. */
  const fallBack = useCallback(async (current: Run) => {
    if (current.stopped) return;
    const spoken = current.relay?.transcripts().worker ?? "";
    current.timers.forEach(clearTimeout); current.timers = [];
    current.relay?.close(); current.relay = null;
    current.call?.close(); current.call = null;
    let guidance: VoiceGuidance | null = null;
    if (spoken) {
      current.captured = true;
      latest.current.loadTranscript([], spoken);
      dispatch({ type: "thinking" });
      try {
        const result = await adapters().extract(spoken, latest.current.context);
        if (current.stopped) return;
        if (result.fields) { current.fields = result.fields; latest.current.applyFields(result.fields); }
        guidance = result.voice ?? null;
        if (!result.fields || !guidance) { finish(current, "review", result.extractionError ?? ""); return; }
      } catch (cause) { finish(current, "review", cause instanceof Error ? cause.message : ""); return; }
    }
    await turns(current, guidance);
  }, [adapters, finish, turns]);

  const realtime = useCallback(async (current: Run, connect: ConnectRealtime) => {
    const session = await adapters().api.session(latest.current.context);
    if (current.stopped) return;
    const { api, extract, prepareCallAudio } = adapters();
    await prepareCallAudio();
    let failing = false;
    const fail = () => { if (!failing && !current.stopped) { failing = true; void fallBack(current); } };

    async function save({ labelled, worker }: RelayTranscripts): Promise<RelaySaveResult> {
      // The model's arguments are never saved: the strict extraction of what was said is.
      const result = await extract(labelled, latest.current.context);
      if (!result.fields) return { saved: false, error: result.extractionError ?? "The details could not be read." };
      current.fields = result.fields;
      latest.current.loadTranscript([], worker);
      latest.current.applyFields(result.fields);
      if (result.voice && result.voice.status !== "ready_to_confirm") return { saved: false, error: "Some details are still missing.", prompt: result.voice.prompt };
      const outcome = await latest.current.save();
      return outcome.stored ? { saved: true, synced: outcome.synced } : { saved: false, error: outcome.error || "The log could not be saved." };
    }
    function ended(reason: RelayEnd, message?: string) {
      if (reason === "failed") fail();
      else finish(current, reason === "saved" ? "saved" : "review", message);
    }
    const relay = createRealtimeRelay({
      send: event => current.call?.send(event), toolName: session.toolName, save, onEnd: ended,
      postState: (transcript, turn) => api.state(latest.current.context, transcript, turn),
      postCheck: args => api.check(args),
      onPhase: (phase, text) => dispatch({ type: phase, text }),
      onFields: fields => { current.fields = fields; },
      schedule: (next, ms) => current.timers.push(setTimeout(next, ms)),
    });
    current.relay = relay;
    let open = false;
    let call: RealtimeCall;
    try {
      call = await connect(session, {
        onOpen: () => { open = true; dispatch({ type: "transport", transport: "realtime" }); relay.open(); },
        onMessage: relay.handle,
        onDown: fail,
      }, offer => exchangeSdp(session, offer));
    } catch (cause) {
      // A connection that dropped while it was being set up has already moved to the turn-based mode.
      if (failing) return;
      throw cause;
    }
    if (current.stopped || failing) { call.close(); return; }
    current.call = call;
    current.timers.push(
      setTimeout(() => { if (!open) fail(); }, latest.current.connectTimeoutMs ?? 8000),
      // A realtime call is billed while it is open.
      setTimeout(() => finish(current, "review", "The voice conversation reached its time limit."), Math.max(30, session.maxSessionSeconds || 300) * 1000),
    );
  }, [adapters, fallBack, finish]);

  const start = useCallback(async () => {
    if (run.current && !run.current.stopped) return;
    const current: Run = { stopped: false, call: null, relay: null, timers: [], captured: false, fields: null };
    run.current = current;
    latest.current.onReset();
    dispatch({ type: "end" }); dispatch({ type: "start" });
    adapters().keepAwake(true);
    try {
      const granted = await adapters().requestMicrophone();
      if (current.stopped) return;
      if (!granted) { finish(current, "error", "Microphone access is blocked. Allow it in Settings, or write a note."); return; }
      const { connect } = adapters();
      if (connect) {
        try { await realtime(current, connect); return; }
        catch { if (current.stopped) return; current.relay?.close(); current.relay = null; }
      }
      await turns(current, null);
    } catch (cause) { finish(current, "error", cause instanceof Error ? cause.message : "Hands-free mode could not start."); }
  }, [adapters, finish, realtime, turns]);

  /** Tap during a session, or the Review on screen button. */
  const stop = useCallback((review = false) => {
    const current = run.current;
    if (current && !current.stopped) finish(current, review ? "review" : "idle");
    else dispatch({ type: "end" });
  }, [finish]);

  useEffect(() => {
    // An open call keeps costing money and the microphone must not outlive the screen.
    // "inactive" is also reported while the microphone permission prompt is showing, so only "background" ends it.
    const listener = AppState.addEventListener("change", next => { if (next === "background" && run.current) finish(run.current, "idle"); });
    return () => { listener.remove(); release(run.current); if (banner.current) clearTimeout(banner.current); };
  }, [finish, release]);

  const phase = state.phase;
  useEffect(() => { if (phase !== "idle") adapters().haptic(phase); }, [adapters, phase]);

  return { ...state, live: isLive(state.phase), start, stop };
}
