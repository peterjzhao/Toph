/**
 * Turn-based hands-free conversation (docs/backend/voice.md, "Flow"). Pure: recording, playback,
 * network and saving are supplied by the caller, so the loop runs unchanged under test.
 */
import type { TranscriptionResult } from "@toph/contracts/transcription";
import type { VoiceConfirmResult, VoiceGuidance } from "@toph/contracts/voice";
import type { RecordingClip } from "../local-drafts";
import type { HandsFreePhase } from "./machine";

export type SaveOutcome = { stored: boolean; synced: boolean; error: string };
export type TurnLimits = {
  /** Follow-up answers and corrections. With the first clip this stays under the eight-clip sync limit. */
  maxFollowUps: number;
  /** Consecutive replies that were silent or not understood before the review form takes over. */
  maxUnclear: number;
};
export const defaultTurnLimits: TurnLimits = { maxFollowUps: 5, maxUnclear: 2 };
export const spoken = {
  opening: "What did you work on?",
  unheard: "I didn't catch that.",
  confirmAgain: "Sorry, say save, or tell me what to change.",
  saved: "Saved.",
  savedOnDevice: "Saved on this phone. Sync it when you are back online.",
  cancelled: "Okay. I kept your draft.",
  review: "Please finish this log on the screen.",
};

export type TurnLoopDeps = {
  /** Records until silence. Null means nothing was said. */
  record(): Promise<RecordingClip | null>;
  /** Appends the clip to the log and extracts; null when transcription failed. */
  process(clip: RecordingClip): Promise<TranscriptionResult | null>;
  confirm(clip: RecordingClip): Promise<VoiceConfirmResult>;
  /** Resolves once playback has fully stopped, so the prompt is never recorded. */
  speak(text: string): Promise<void>;
  save(): Promise<SaveOutcome>;
  onPhase(phase: Extract<HandsFreePhase, "listening" | "thinking" | "speaking">, text?: string): void;
  /** True once the session was cancelled; checked after every await. */
  stopped(): boolean;
  limits?: Partial<TurnLimits>;
};
export type TurnLoopOutcome = { end: "saved" | "review" | "cancelled" | "stopped"; message: string };
const outcome = (end: TurnLoopOutcome["end"], message = ""): TurnLoopOutcome => ({ end, message });

/** `guidance` continues a conversation that already has a transcript (a dropped realtime call). */
export async function runTurnLoop(deps: TurnLoopDeps, guidance: VoiceGuidance | null = null): Promise<TurnLoopOutcome> {
  const limits = { ...defaultTurnLimits, ...deps.limits };
  let followUps = 0, unclear = 0, repeat = "";
  const say = async (text: string) => { deps.onPhase("speaking", text); await deps.speak(text); };
  const listen = async () => { deps.onPhase("listening"); return deps.record(); };
  // Leaving for the review form is said aloud: the worker may not be looking at the phone.
  const review = async (message = "") => { await say(spoken.review).catch(() => undefined); return outcome("review", message); };

  try {
    for (;;) {
      if (deps.stopped()) return outcome("stopped");
      if (guidance?.status === "ready_to_confirm") {
        await say(repeat || guidance.prompt);
        if (deps.stopped()) return outcome("stopped");
        const clip = await listen();
        if (deps.stopped()) return outcome("stopped");
        deps.onPhase("thinking");
        const reply: VoiceConfirmResult = clip ? await deps.confirm(clip) : { transcript: "", intent: "unclear" };
        if (deps.stopped()) return outcome("stopped");
        if (reply.intent === "save") {
          const saved = await deps.save();
          if (deps.stopped()) return outcome("stopped");
          if (!saved.stored) return review(saved.error);
          await say(saved.synced ? spoken.saved : spoken.savedOnDevice).catch(() => undefined);
          return outcome("saved", saved.error);
        }
        if (reply.intent === "cancel") { await say(spoken.cancelled).catch(() => undefined); return outcome("cancelled"); }
        if (reply.intent === "change" && clip) {
          if (followUps >= limits.maxFollowUps) return review();
          followUps += 1; unclear = 0; repeat = "";
          // The reply is already transcribed, so only the extraction runs again.
          const result = await deps.process({ ...clip, transcript: reply.transcript });
          if (!result?.fields || !result.voice) return review(result?.extractionError ?? "");
          guidance = result.voice;
          continue;
        }
        unclear += 1;
        if (unclear > limits.maxUnclear) return review();
        repeat = spoken.confirmAgain;
        continue;
      }

      // The opening clip, or an answer to a question about missing facts.
      if (guidance && !repeat) {
        if (followUps >= limits.maxFollowUps) return review();
        followUps += 1;
      }
      await say(repeat || (guidance ? guidance.prompt : spoken.opening));
      if (deps.stopped()) return outcome("stopped");
      const clip = await listen();
      if (deps.stopped()) return outcome("stopped");
      if (!clip) {
        unclear += 1;
        if (unclear > limits.maxUnclear) return guidance ? review() : outcome("cancelled");
        repeat = `${spoken.unheard} ${guidance ? guidance.prompt : spoken.opening}`;
        continue;
      }
      unclear = 0; repeat = "";
      deps.onPhase("thinking");
      const result = await deps.process(clip);
      if (deps.stopped()) return outcome("stopped");
      // No guidance (extraction failed, or an older server): the form shows the transcript and a retry.
      if (!result?.fields || !result.voice) return review(result?.extractionError ?? "");
      guidance = result.voice;
    }
  } catch (cause) {
    if (deps.stopped()) return outcome("stopped");
    return review(cause instanceof Error ? cause.message : "Hands-free mode stopped. Finish the log on the screen.");
  }
}
