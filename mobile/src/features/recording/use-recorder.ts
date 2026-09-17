import {
  RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, type RecordingStatus,
} from "expo-audio";
import { useCallback, useEffect, useRef, useState } from "react";
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

export function useRecorder() {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>(idleLevels);
  const [audio, setAudio] = useState<RecordingAudio | null>(null);
  const [error, setError] = useState("");
  const statusRef = useRef<RecorderStatus>("idle");
  const accumulated = useRef(0);
  const started = useRef(0);
  const generation = useRef(0);
  const onStatus = useRef<(event: RecordingStatus) => void>(() => {});
  const recorder = useAudioRecorder(recordingOptions, (event) => onStatus.current(event));

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
      let level: number | null = null;
      try { level = meterToLevel(recorder.getStatus().metering); } catch { level = null; }
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
    reset();
    const attempt = generation.current;
    update("requesting");
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (attempt !== generation.current) return;
      if (!permission.granted) throw new Error("Microphone access is blocked. Check microphone permissions or write a note.");
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
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

  return { status, seconds, levels, audio, error, start, pause, resume, finish, reset, load };
}
