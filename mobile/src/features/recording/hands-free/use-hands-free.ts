/**
 * Hands-free voice logging. One state machine, two transports: an OpenAI Realtime call over WebRTC
 * when the native module is in this build, and the turn-based record / speak loop otherwise or when
 * the call fails. Both end in the review form's own save; nothing here writes a log by itself.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import { AppState } from "react-native";
import type { ExtractedLogFields, TranscriptionResult } from "@toph/contracts/transcription";
import type { VoiceGuidance, VoiceSession } from "@toph/contracts/voice";
import type { RecordingAudio, RecordingClip } from "../local-drafts";
import type { useRecorder } from "../use-recorder";
import { stitchCallAudio } from "./call-recording";
import { idleState, isLive, reduceHandsFree, type HandsFreePhase } from "./machine";
import { createSessionWarmer, type SessionWarmer } from "./prewarm";
import { createRealtimeRelay, type RelayEnd } from "./realtime-relay";
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
  /** Keeps a call's recording (a WAV) as a file the draft can copy. */
  writeRecording(wav: Uint8Array): RecordingAudio;
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
  /** The log's audio limit; a long call's recording is made smaller to fit it. */
  maxRecordingBytes?: number;
  /** After a spoken approval, how long the model may take to finish its sentence before the call is closed anyway. */
  lastWordsMs?: number;
  /** When a call ends, how long to wait for turns whose audio is still arriving for the recording. */
  audioWaitMs?: number;
};

type Relay = ReturnType<typeof createRealtimeRelay>;
type Run = { stopped: boolean; call: RealtimeCall | null; relay: Relay | null; timers: ReturnType<typeof setTimeout>[]; captured: boolean; fields: ExtractedLogFields | null };
type PendingClip = { resolve(clip: RecordingClip | null): void; reject(cause: Error): void; detector: ReturnType<typeof createSilenceDetector>; verdict: SilenceVerdict | null; recording: boolean };
/**
 * How a call that is being saved ends. "after speech": the worker approved by voice, so the model's reply
 * ("Saving it now") plays to its end. "now": the worker tapped to save, so the model stops mid-sentence.
 */
type HangUp = "after speech" | "now";
/** The events channel OpenAI expects; created before the session arrives so the offer can be built early. */
const realtimeDataChannel = "oai-events";
/** Thinking and speaking alternate within one reply; a buzz at every change is noise. */
const unannounced = new Set<HandsFreePhase>(["thinking", "speaking"]);
let nativeAdapters: HandsFreeAdapters | null = null;
/** Loaded on the first session, or earlier by `prewarm`; drawing the switch alone needs no native module. */
function defaultAdapters(): HandsFreeAdapters {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  nativeAdapters ??= (require("./native-adapters") as typeof import("./native-adapters")).createNativeAdapters();
  return nativeAdapters;
}

export function useHandsFree(options: HandsFreeOptions) {
  const latest = useRef(options); latest.current = options;
  const [state, dispatch] = useReducer(reduceHandsFree, idleState);
  const run = useRef<Run | null>(null);
  const warmer = useRef<SessionWarmer | null>(null);
  const pending = useRef<PendingClip | null>(null);
  const banner = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Calls kept open after the save for the model's last words and the last turn's audio. */
  const lingering = useRef(new Set<() => void>());
  const adapters = useCallback((): HandsFreeAdapters => {
    const given = latest.current.adapters ?? {};
    const complete = ["api", "speaker", "connect", "extract", "requestMicrophone", "prepareCallAudio", "haptic", "keepAwake", "writeRecording"].every(key => key in given);
    return complete ? given as HandsFreeAdapters : { ...defaultAdapters(), ...given };
  }, []);
  const hangUpLingering = useCallback(() => { lingering.current.forEach(close => close()); }, []);

  /**
   * Closes the call, the microphone and playback. Safe to call twice. With `hangUp` (the log is being
   * saved) the call stays up, muted, a moment longer: see `HangUp`, and the recording's last turn.
   */
  const release = useCallback((current: Run | null, hangUp?: HangUp) => {
    if (!current || current.stopped) return;
    current.stopped = true;
    current.timers.forEach(clearTimeout);
    const { relay, call } = current;
    if (hangUp && relay && call) {
      call.mute();
      if (hangUp === "now") relay.silence();
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true; clearTimeout(cap); lingering.current.delete(close);
        relay.close(); call.close();
      };
      const cap = setTimeout(close, latest.current.lastWordsMs ?? 8000);
      lingering.current.add(close);
      void Promise.all([hangUp === "after speech" ? relay.quiet() : null, relay.audio(latest.current.audioWaitMs)]).then(close);
    } else {
      relay?.close();
      call?.close();
    }
    const clip = pending.current; pending.current = null;
    if (clip) { latest.current.recorder.reset(); clip.resolve(null); }
    void adapters().speaker.stop();
    adapters().keepAwake(false);
  }, [adapters]);

  /** The worker's turns as one clip, from the audio fetched so far. Never throws: the log is kept without it. */
  const recordingClip = useCallback((segments: string[], spoken: string): RecordingClip | null => {
    if (!spoken) return null;
    try {
      const recording = stitchCallAudio(segments, { maxBytes: latest.current.maxRecordingBytes });
      return recording && { audio: adapters().writeRecording(recording.bytes), durationSeconds: recording.durationSeconds, transcript: spoken };
    } catch { return null; }
  }, [adapters]);
  /** A call's words go to the form as its recording's transcript, or as clipless speech without one. */
  const loadCall = useCallback((clip: RecordingClip | null, spoken: string) => {
    latest.current.loadTranscript(clip ? [clip] : [], clip ? "" : spoken);
  }, []);

  /** Ends the session. Anything already said is handed to the review form rather than dropped. */
  const finish = useCallback((current: Run, to: "saved" | "review" | "idle" | "error", message = "") => {
    if (current.stopped) return;
    const spoken = current.relay?.transcripts().worker ?? "";
    // Turns whose audio is still on its way are left out: stopping does not wait.
    const clip = spoken && to !== "saved" ? recordingClip(current.relay?.recorded() ?? [], spoken) : null;
    release(current);
    if (run.current === current) run.current = null;
    if (spoken && to !== "saved") { loadCall(clip, spoken); if (current.fields) latest.current.applyFields(current.fields); }
    if (to === "saved") {
      dispatch({ type: "saved" });
      banner.current = setTimeout(() => dispatch({ type: "end" }), latest.current.savedBannerMs ?? 2500);
    } else if (to === "error") dispatch({ type: "fail", message });
    else {
      dispatch({ type: "end" });
      if (to === "review" || current.captured || spoken) latest.current.onReview(message);
    }
  }, [loadCall, recordingClip, release]);

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
      process: async clip => {
        current.captured = true;
        // While an answer is being read, the form does not yet hold it: no saving by tap.
        dispatch({ type: "ready", ready: false });
        const processed = await latest.current.appendClip(clip);
        if (!current.stopped) dispatch({ type: "ready", ready: processed?.voice?.status === "ready_to_confirm" });
        return processed;
      },
      confirm: clip => api.confirm(clip.audio, latest.current.context),
      // Playback is stopped outright before the microphone opens, so the prompt is never transcribed.
      speak: async text => { await speaker.speak(text); await speaker.stop(); },
      save: () => { dispatch({ type: "ready", ready: false }); return latest.current.save(); },
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
    // The form only holds the call's details once the extraction below has run.
    dispatch({ type: "ready", ready: false });
    const spoken = current.relay?.transcripts().worker ?? "";
    const clip = recordingClip(current.relay?.recorded() ?? [], spoken);
    current.timers.forEach(clearTimeout); current.timers = [];
    current.relay?.close(); current.relay = null;
    current.call?.close(); current.call = null;
    let guidance: VoiceGuidance | null = null;
    if (spoken) {
      current.captured = true;
      loadCall(clip, spoken);
      dispatch({ type: "thinking" });
      try {
        const result = await adapters().extract(spoken, latest.current.context);
        if (current.stopped) return;
        if (result.fields) { current.fields = result.fields; latest.current.applyFields(result.fields); }
        guidance = result.voice ?? null;
        if (!result.fields || !guidance) { finish(current, "review", result.extractionError ?? ""); return; }
      } catch (cause) { finish(current, "review", cause instanceof Error ? cause.message : ""); return; }
    }
    dispatch({ type: "ready", ready: guidance?.status === "ready_to_confirm" });
    await turns(current, guidance);
  }, [adapters, finish, loadCall, recordingClip, turns]);

  /** The review form's Save log, behind the black "Got it" screen; anything short of a stored log opens the form. */
  const storeLog = useCallback(async () => {
    const review = (message: string) => { dispatch({ type: "end" }); latest.current.onReview(message); };
    try {
      const outcome = await latest.current.save();
      if (!outcome.stored) { review(outcome.error || "The log could not be saved."); return; }
      dispatch({ type: "saved" });
      banner.current = setTimeout(() => dispatch({ type: "end" }), latest.current.savedBannerMs ?? 1500);
    } catch (cause) { review(cause instanceof Error ? cause.message : "The log could not be saved."); }
  }, []);

  /**
   * Save by voice approval or by tap: the call ends (see `HangUp`), then the strict extraction of what was
   * said and the call's recording go into the form, and it is saved behind the "Got it" screen.
   */
  const saveAfterCall = useCallback(async (current: Run, hangUp: HangUp) => {
    if (current.stopped) return;
    const relay = current.relay;
    const { labelled, worker } = relay?.transcripts() ?? { labelled: "", worker: "" };
    release(current, hangUp);
    if (run.current === current) run.current = null;
    dispatch({ type: "saving" });
    const review = (message: string) => { dispatch({ type: "end" }); latest.current.onReview(message); };
    // The recording is fetched alongside the extraction; neither waits for the other.
    const loaded = (relay ? relay.audio(latest.current.audioWaitMs) : Promise.resolve([])).then(segments => loadCall(recordingClip(segments, worker), worker)).catch(() => undefined);
    try {
      // The model's arguments are never saved: the strict extraction of what was said is.
      const [result] = await Promise.all([adapters().extract(labelled, latest.current.context), loaded]);
      if (!result.fields) { if (current.fields) latest.current.applyFields(current.fields); review(result.extractionError ?? "The details could not be read."); return; }
      latest.current.applyFields(result.fields);
      if (result.voice && result.voice.status !== "ready_to_confirm") { review("Some details are still missing."); return; }
      await storeLog();
    } catch (cause) {
      await loaded;
      review(cause instanceof Error ? cause.message : "The log could not be saved.");
    }
  }, [adapters, loadCall, recordingClip, release, storeLog]);

  /** Turn by turn, every answer is already in the form, so a tap saves it as it stands. */
  const saveTurns = useCallback(async (current: Run) => {
    release(current);
    if (run.current === current) run.current = null;
    dispatch({ type: "saving" });
    await storeLog();
  }, [release, storeLog]);

  /** One warmer per mounted screen; the secret it holds is dropped when the screen goes away. */
  const sessionWarmer = useCallback(() => {
    warmer.current ??= createSessionWarmer({ session: () => adapters().api.session(latest.current.context) });
    return warmer.current;
  }, [adapters]);

  /**
   * Called while the capture screen is showing. Mints the call's secret and sets the audio route ahead of
   * the tap, so starting a call does not wait on Toph and OpenAI first. Loads the native audio modules.
   */
  const prewarm = useCallback(() => {
    if (run.current && !run.current.stopped) return;
    // Purely an optimisation: a build without these native modules, or a mint that is refused, must not
    // reach the screen. The tap runs the same code again and reports whatever it hits properly.
    try {
      // Turn-based mode has no session to warm, and Expo Go has no WebRTC to warm it for.
      if (!adapters().connect) return;
      sessionWarmer().warm();
      void adapters().prepareCallAudio();
    } catch { /* the capture screen still draws, and Call mode still works */ }
  }, [adapters, sessionWarmer]);

  const realtime = useCallback(async (current: Run, connect: ConnectRealtime) => {
    const { api, prepareCallAudio } = adapters();
    let failing = false;
    const fail = () => { if (!failing && !current.stopped) { failing = true; void fallBack(current); } };
    let open = false, relay: Relay | null = null;
    // Covers the session request, the microphone, the offer and the SDP exchange as well as the channel.
    current.timers.push(setTimeout(() => { if (!open) fail(); }, latest.current.connectTimeoutMs ?? 15_000));
    // A secret warmed while the capture screen was open turns the tap into an SDP exchange and nothing
    // more. Without one it is minted here, alongside the microphone and the offer as before.
    const pendingSession = sessionWarmer().take() ?? api.session(latest.current.context);
    pendingSession.catch(() => undefined);
    // The audio route does not gate the offer, and prewarming has usually set it already.
    void prepareCallAudio();
    const connecting = connect(realtimeDataChannel, {
      onOpen: () => {
        open = true; dispatch({ type: "transport", transport: "realtime" }); relay?.open();
        // WebRTC configures the session for the earpiece when its audio starts; route to the loudspeaker again.
        void prepareCallAudio();
      },
      onMessage: message => relay?.handle(message),
      onDown: fail,
    }, async offer => exchangeSdp(await pendingSession, offer));
    connecting.catch(() => undefined);
    let session: VoiceSession;
    try { session = await pendingSession; }
    catch (cause) { void connecting.then(call => call.close(), () => undefined); throw cause; }
    if (current.stopped) { void connecting.then(call => call.close(), () => undefined); return; }

    function ended(reason: RelayEnd, message?: string) {
      if (reason === "failed") fail();
      else if (reason === "confirmed") void saveAfterCall(current, "after speech");
      else finish(current, "review", message);
    }
    relay = createRealtimeRelay({
      send: event => current.call?.send(event), toolName: session.toolName, onEnd: ended,
      postState: (transcript, turn) => api.state(latest.current.context, transcript, turn),
      postCheck: args => api.check(args),
      onPhase: (phase, text) => dispatch({ type: phase, text }),
      onFields: fields => { current.fields = fields; },
      onReady: ready => { if (!current.stopped) dispatch({ type: "ready", ready }); },
    });
    current.relay = relay;
    let call: RealtimeCall;
    try { call = await connecting; }
    catch (cause) {
      // A connection that dropped while it was being set up has already moved to the turn-based mode.
      if (failing) return;
      throw cause;
    }
    if (current.stopped || failing) { call.close(); return; }
    current.call = call;
    // The channel can open before the call is handed back; the greeting needs the call to send on.
    if (open) relay.open();
    // A realtime call is billed while it is open.
    current.timers.push(setTimeout(() => finish(current, "review", "The voice conversation reached its time limit."), Math.max(30, session.maxSessionSeconds || 300) * 1000));
  }, [adapters, fallBack, finish, saveAfterCall, sessionWarmer]);

  const start = useCallback(async () => {
    if (run.current && !run.current.stopped) return;
    // A saved call still finishing its last sentence gives way to the new one.
    hangUpLingering();
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
  }, [adapters, finish, hangUpLingering, realtime, turns]);

  /** Tap during a session, or the Review on screen button. */
  const stop = useCallback((review = false) => {
    const current = run.current;
    if (current && !current.stopped) finish(current, review ? "review" : "idle");
    else dispatch({ type: "end" });
  }, [finish]);

  /** "Tap anywhere to save": shown once every required detail is in. The call ends and the log is saved. */
  const saveNow = useCallback(() => {
    const current = run.current;
    if (!current || current.stopped) return;
    if (current.relay) void saveAfterCall(current, "now");
    else void saveTurns(current);
  }, [saveAfterCall, saveTurns]);

  useEffect(() => {
    // An open call keeps costing money and the microphone must not outlive the screen.
    // "inactive" is also reported while the microphone permission prompt is showing, so only "background" ends it.
    const listener = AppState.addEventListener("change", next => {
      if (next !== "background") return;
      if (run.current) finish(run.current, "idle");
      hangUpLingering();
    });
    return () => { listener.remove(); release(run.current); hangUpLingering(); warmer.current?.clear(); if (banner.current) clearTimeout(banner.current); };
  }, [finish, hangUpLingering, release]);

  const phase = state.phase;
  const previousPhase = useRef<HandsFreePhase>("idle");
  useEffect(() => {
    const from = previousPhase.current;
    previousPhase.current = phase;
    if (phase !== "idle" && !(unannounced.has(from) && unannounced.has(phase))) adapters().haptic(phase);
  }, [adapters, phase]);

  return { ...state, live: isLive(state.phase), start, stop, saveNow, prewarm };
}
