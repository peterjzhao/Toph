import {
  getRecordingPermissionsAsync, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, setIsAudioActiveAsync, useAudioRecorder, type RecordingStatus,
} from "expo-audio";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { RecordingAudio } from "./local-drafts";

export type RecorderStatus = "idle" | "requesting" | "recording" | "paused" | "stopping" | "ready";
export const barCount = 48;
const idleLevels = () => Array<number>(barCount).fill(3);
const recordingOptions = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };
const outputMimeType = "audio/mp4";

/** Maps the recorder's metering value (dB, silence around -60 or below) onto the 3px to 48px bar range. */
function meterToLevel(metering: number | undefined) {
  if (typeof metering !== "number" || !Number.isFinite(metering)) return null;
  const amplitude = Math.min(1, Math.max(0, (metering + 60) / 60));
  return 3 + amplitude * 45;
}

function extensionOf(uri: string) {
  const match = /\.([a-z0-9]+)(?:\?.*)?$/i.exec(uri);
  return match ? match[1].toLowerCase() : "m4a";
}

/**
 * `prewarm` configures the audio session and prepares the recording file while the screen is idle, so a tap
 * only has to call record(). Preparing does not capture audio or show the microphone indicator, but it does
 * activate the session, which pauses other apps' audio. It never opens the permission prompt.
 */
export function useRecorder({ prewarm = false }: { prewarm?: boolean } = {}) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>(idleLevels);
  // Latest input level in dB, or null when the platform reports none. Hands-free mode stops a clip on silence.
  const [metering, setMetering] = useState<number | null>(null);
  const [audio, setAudio] = useState<RecordingAudio | null>(null);
  const [error, setError] = useState("");
  const statusRef = useRef<RecorderStatus>("idle");
  const accumulated = useRef(0);
  const started = useRef(0);
  const generation = useRef(0);
  const permission = useRef<ReturnType<typeof getRecordingPermissionsAsync> | null>(null);
  const onStatus = useRef<(event: RecordingStatus) => void>(() => {});
  const recorder = useAudioRecorder(recordingOptions, (event) => onStatus.current(event));

  // Resolves true once the recorder is prepared and only record() is left to call.
  const warm = useRef<Promise<boolean> | null>(null);

  const warmUp = useCallback(() => {
    if (!prewarm || warm.current || statusRef.current !== "idle") return;
    const pending = (async () => {
      const access = await permission.current;
      if (!access?.granted) return false;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync(recordingOptions);
      return true;
    })().catch(() => false);
    warm.current = pending;
    // A failed attempt must not block the next one (permission granted later, returning from Settings).
    void pending.then(ready => { if (!ready && warm.current === pending) warm.current = null; });
  }, [prewarm, recorder]);

  // Read existing permission before the tap. Only Start may open the system prompt.
  useEffect(() => {
    const refreshPermission = () => {
      const pending = getRecordingPermissionsAsync();
      permission.current = pending;
      void pending.catch(() => { if (permission.current === pending) permission.current = null; });
    };
    refreshPermission();
    warmUp();
    const listener = AppState.addEventListener("change", state => {
      if (state === "active") { refreshPermission(); warmUp(); return; }
      permission.current = null;
      // Hand the audio session back while the app is away; the next tap or return prepares again.
      if (warm.current && statusRef.current === "idle") void setIsAudioActiveAsync(false).catch(() => {});
      warm.current = null;
    });
    return () => listener.remove();
  }, [warmUp]);

  // Back on the idle screen after a recording or a discarded draft: prepare the next one.
  useEffect(() => { if (status === "idle") warmUp(); }, [status, warmUp]);

  const update = useCallback((next: RecorderStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const stopQuietly = useCallback(() => {
    recorder.stop().catch(() => {});
  }, [recorder]);

  const reset = useCallback(() => {
    generation.current += 1;
    if (statusRef.current === "recording" || statusRef.current === "paused" || statusRef.current === "stopping") stopQuietly();
    accumulated.current = 0;
    setAudio(null);
    setSeconds(0);
    setLevels(idleLevels());
    setMetering(null);
    update("idle");
    setError("");
  }, [stopQuietly, update]);

  useEffect(() => () => {
    generation.current += 1;
    if (statusRef.current === "recording" || statusRef.current === "paused") stopQuietly();
  }, [stopQuietly]);

  useEffect(() => {
    if (status !== "recording") return;
    const interval = setInterval(() => {
      const elapsed = accumulated.current + Date.now() - started.current;
      setSeconds(elapsed / 1000);
      let decibels: number | undefined;
      try { decibels = recorder.getStatus().metering; } catch { decibels = undefined; }
      const level = meterToLevel(decibels);
      setMetering(level === null ? null : decibels!);
      setLevels((current) => {
        const next = level ?? 5 + Math.abs(Math.sin(elapsed / 290) * Math.cos(elapsed / 900)) * 43;
        return [...current.slice(1), next];
      });
    }, 100);
    return () => clearInterval(interval);
  }, [status, recorder]);

  // Interruptions (phone calls, another app taking the microphone) end the recording like the web app's ended track.
  onStatus.current = (event) => {
    const current = statusRef.current;
    if (current !== "recording" && current !== "paused") return;
    if (event.hasError) {
      generation.current += 1;
      accumulated.current = 0;
      setError("Recording was interrupted. Please try again or write a note.");
      update("idle");
      return;
    }
    if (event.isFinished) {
      generation.current += 1;
      if (current === "recording") accumulated.current += Date.now() - started.current;
      setSeconds(accumulated.current / 1000);
      const uri = event.url ?? recorder.uri;
      if (!uri) {
        setError("No audio was captured. Check your microphone and try again.");
        update("idle");
        return;
      }
      setAudio({ uri, mimeType: outputMimeType, extension: extensionOf(uri) });
      update("ready");
    }
  };

  async function start() {
    if (["requesting", "recording", "paused", "stopping"].includes(statusRef.current)) return;
    const warmed = warm.current;
    warm.current = null;
    reset();
    const attempt = generation.current;
    update("requesting");
    try {
      if (warmed && await warmed) {
        if (attempt !== generation.current) return;
        // Playback or a call may have changed the session since it was prepared; then set up again below.
        let recording = false;
        try { recorder.record(); recording = recorder.getStatus().isRecording; } catch { recording = false; }
        if (recording) { started.current = Date.now(); update("recording"); return; }
      }
      if (attempt !== generation.current) return;
      const existing = await permission.current?.catch(() => null);
      if (attempt !== generation.current) return;
      const access = existing?.granted ? existing : await requestRecordingPermissionsAsync();
      permission.current = Promise.resolve(access);
      if (attempt !== generation.current) return;
      if (!access.granted) throw new Error("Microphone access is blocked. Check microphone permissions or write a note.");
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      if (attempt !== generation.current) return;
      // Supplying options creates a new native file on iOS for each appended clip.
      await recorder.prepareToRecordAsync(recordingOptions);
      if (attempt !== generation.current) { stopQuietly(); return; }
      recorder.record();
      started.current = Date.now();
      update("recording");
    } catch (cause) {
      if (attempt !== generation.current) return;
      update("idle");
      setError(cause instanceof Error && cause.message ? cause.message : "Recording could not start. Please try again.");
    }
  }

  function pause() {
    if (statusRef.current !== "recording") return;
    accumulated.current += Date.now() - started.current;
    try { recorder.pause(); } catch { /* The timer stops even if the platform could not pause. */ }
    setSeconds(accumulated.current / 1000);
    update("paused");
  }

  function resume() {
    if (statusRef.current !== "paused") return;
    started.current = Date.now();
    recorder.record();
    update("recording");
  }

  async function finish() {
    const current = statusRef.current;
    if (current !== "recording" && current !== "paused") return;
    if (current === "recording") accumulated.current += Date.now() - started.current;
    setSeconds(accumulated.current / 1000);
    update("stopping");
    const attempt = generation.current;
    try {
      await recorder.stop();
      if (attempt !== generation.current) return;
      const uri = recorder.uri;
      if (!uri) {
        setError("No audio was captured. Check your microphone and try again.");
        update("idle");
        return;
      }
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      if (attempt !== generation.current) return;
      setAudio({ uri, mimeType: outputMimeType, extension: extensionOf(uri) });
      update("ready");
    } catch {
      if (attempt !== generation.current) return;
      setError("Recording was interrupted. Please try again or write a note.");
      update("idle");
    }
  }

  function load(nextAudio: RecordingAudio | null, duration: number) {
    reset();
    setAudio(nextAudio);
    setSeconds(duration);
    update("ready");
  }

  return { status, seconds, levels, metering, audio, error, start, pause, resume, finish, reset, load };
}
