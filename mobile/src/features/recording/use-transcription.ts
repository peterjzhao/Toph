import { useCallback, useEffect, useRef, useState } from "react";
import type { RecordingClip } from "./local-drafts";
import { transcribeRecording } from "./transcribe";

export type Transcript = { status: "idle" | "working" | "done" | "error" | "cancelled"; text: string; message: string };
const initial: Transcript = { status: "idle", text: "", message: "" };
const transcriptText = (clips: RecordingClip[]) => clips.map(clip => clip.transcript).filter(Boolean).join("\n\n");

/** Each clip keeps its transcript; append/retry never retranscribes completed clips. */
export function useTranscription() {
  const [clips, setClips] = useState<RecordingClip[]>([]);
  const clipsRef = useRef<RecordingClip[]>([]);
  const [transcript, setTranscript] = useState<Transcript>(initial);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const cancel = useCallback(() => {
    if (!request.current) return;
    generation.current += 1;
    request.current?.abort();
    request.current = null;
    setTranscript({ status: "cancelled", text: transcriptText(clipsRef.current), message: "Transcription cancelled. Your recording is kept on this device." });
  }, []);

  const load = useCallback((next: RecordingClip[]) => {
    generation.current += 1;
    request.current?.abort();
    request.current = null;
    clipsRef.current = next;
    setClips(next);
    setTranscript({ status: next.length && next.every(clip => clip.transcript) ? "done" : "idle", text: transcriptText(next), message: "" });
  }, []);

  const run = useCallback(async (next = clipsRef.current) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const runId = ++generation.current;
    clipsRef.current = next;
    setClips(next);
    setTranscript({ status: "working", text: transcriptText(next), message: "" });
    try {
      for (let index = 0; index < next.length; index += 1) {
        if (next[index].transcript) continue;
        const text = await transcribeRecording(next[index].audio, { signal: controller.signal });
        if (runId !== generation.current) return;
        next = next.map((clip, position) => position === index ? { ...clip, transcript: text } : clip);
        clipsRef.current = next;
        setClips(next);
      }
      if (runId !== generation.current) return;
      setTranscript({ status: "done", text: transcriptText(next), message: "" });
    } catch (cause) {
      if (runId !== generation.current) return;
      setTranscript({ status: "error", text: transcriptText(clipsRef.current), message: cause instanceof Error ? cause.message : "Transcription failed. Please try again." });
    } finally {
      if (runId === generation.current) request.current = null;
    }
  }, []);

  const append = useCallback((clip: RecordingClip) => run([...clipsRef.current, clip]), [run]);
  useEffect(() => () => { generation.current += 1; request.current?.abort(); }, []);
  return { clips, transcript, cancel, load, run, append };
}
