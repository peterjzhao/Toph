import { useCallback, useEffect, useRef, useState } from "react";
import type { ExtractedLogFields, TranscriptionContext, TranscriptionResult } from "@toph/contracts/transcription";
import type { RecordingClip } from "./local-drafts";
import { extractRecordingDetails, transcribeRecording } from "./transcribe";

export type Transcript = { status: "idle" | "working" | "done" | "error" | "cancelled"; text: string; message: string };
const initial: Transcript = { status: "idle", text: "", message: "" };
const transcriptText = (clips: RecordingClip[]) => clips.map(clip => clip.transcript).filter(Boolean).join("\n\n");
type Options = { context: Omit<TranscriptionContext, "previousTranscript">; onFields: (fields: ExtractedLogFields) => void };

/** Retain each clip's speech and retry extraction without retranscribing completed audio. */
export function useTranscription(options: Options) {
  const latest = useRef(options); latest.current = options;
  const [clips, setClips] = useState<RecordingClip[]>([]);
  const clipsRef = useRef<RecordingClip[]>([]);
  const [transcript, setTranscript] = useState<Transcript>(initial);
  const [extractedFields, setExtractedFields] = useState<ExtractedLogFields | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const cancel = useCallback(() => {
    if (!request.current) return;
    generation.current += 1;
    request.current.abort(); request.current = null;
    setTranscript({ status: "cancelled", text: transcriptText(clipsRef.current), message: "Transcription cancelled. Your recording is kept on this device." });
  }, []);
  const load = useCallback((next: RecordingClip[]) => {
    generation.current += 1;
    request.current?.abort(); request.current = null;
    clipsRef.current = next; setClips(next);
    setExtractedFields(null);
    setTranscript({ status: next.length && next.every(clip => clip.transcript) ? "done" : "idle", text: transcriptText(next), message: "" });
  }, []);
  const run = useCallback(async (next = clipsRef.current) => {
    if (!next.length) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const runId = ++generation.current;
    const context = { ...latest.current.context };
    clipsRef.current = next; setClips(next);
    setTranscript({ status: "working", text: transcriptText(next), message: "" });
    try {
      let result: TranscriptionResult | null = null;
      for (let index = 0; index < next.length; index += 1) {
        if (next[index].transcript) continue;
        result = await transcribeRecording(next[index].audio, { signal: controller.signal, context: { ...context, previousTranscript: transcriptText(next.slice(0, index)) } });
        if (runId !== generation.current) return;
        next = next.map((clip, position) => position === index ? { ...clip, transcript: result!.text } : clip);
        clipsRef.current = next; setClips(next);
      }
      // Cached speech or mixed completed clips still needs one extraction over the entire log.
      if (!result || result.transcript !== transcriptText(next)) {
        result = await extractRecordingDetails(transcriptText(next), { signal: controller.signal, context });
      }
      if (runId !== generation.current) return;
      if (result.fields) {
        setExtractedFields(result.fields);
        latest.current.onFields(result.fields);
      }
      setTranscript({ status: result.extractionError ? "error" : "done", text: transcriptText(next),
        message: result.extractionError || "" });
    } catch (cause) {
      if (runId !== generation.current) return;
      setTranscript({ status: "error", text: transcriptText(clipsRef.current), message: cause instanceof Error ? cause.message : "Transcription failed. Please try again." });
    } finally { if (runId === generation.current) request.current = null; }
  }, []);
  const append = useCallback((clip: RecordingClip) => run([...clipsRef.current, clip]), [run]);
  useEffect(() => () => { generation.current += 1; request.current?.abort(); }, []);
  return { clips, transcript, extractedFields, cancel, load, run, append };
}
