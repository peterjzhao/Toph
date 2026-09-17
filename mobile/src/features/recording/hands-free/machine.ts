/** Hands-free session states shared by the realtime and turn-based transports. Pure: no native imports. */
import { tokens } from "@toph/design";

export type HandsFreePhase = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "saved" | "error";
export type HandsFreeTransport = "realtime" | "turns";
export type HandsFreeState = {
  phase: HandsFreePhase;
  transport: HandsFreeTransport | null;
  /** The sentence being spoken, or why the session stopped. */
  message: string;
};
export type HandsFreeEvent =
  | { type: "start" }
  | { type: "transport"; transport: HandsFreeTransport }
  | { type: "listening" }
  | { type: "thinking" }
  | { type: "speaking"; text?: string }
  | { type: "saved" }
  | { type: "fail"; message: string }
  | { type: "end" };

export const idleState: HandsFreeState = { phase: "idle", transport: null, message: "" };
const live: HandsFreePhase[] = ["connecting", "listening", "thinking", "speaking"];
/** A microphone or a call may be open; the session must be closed before anything else uses audio. */
export const isLive = (phase: HandsFreePhase) => live.includes(phase);

export function reduceHandsFree(state: HandsFreeState, event: HandsFreeEvent): HandsFreeState {
  if (event.type === "end") return idleState;
  if (event.type === "start") return isLive(state.phase) ? state : { phase: "connecting", transport: null, message: "" };
  // Late adapter callbacks after a session ended, saved or failed must not revive it.
  if (!isLive(state.phase)) return state;
  switch (event.type) {
    case "transport": return { ...state, transport: event.transport };
    case "listening": return { ...state, phase: "listening", message: "" };
    case "thinking": return { ...state, phase: "thinking" };
    case "speaking": return { ...state, phase: "speaking", message: event.text ?? state.message };
    case "saved": return { ...state, phase: "saved", message: "" };
    case "fail": return { ...state, phase: "error", message: event.message };
  }
}

type Display = { label: string; hint: string; background: string; foreground: string };
const { colors } = tokens;
/** One colour per state, chosen from the shared tokens so the state is readable at arm's length. */
export const phaseDisplay: Record<HandsFreePhase, Display> = {
  idle: { label: "Tap to start", hint: "Starts a hands-free voice log", background: colors.surfaceMuted, foreground: colors.text },
  connecting: { label: "Connecting", hint: "Tap anywhere to cancel", background: colors.textMuted, foreground: colors.surface },
  listening: { label: "Listening", hint: "Speak now. Tap anywhere to stop", background: colors.brand, foreground: colors.surface },
  thinking: { label: "Thinking", hint: "Tap anywhere to stop", background: colors.textMuted, foreground: colors.surface },
  speaking: { label: "Speaking", hint: "Tap anywhere to stop", background: colors.fieldOutline, foreground: colors.surface },
  saved: { label: "Saved", hint: "Tap to continue", background: colors.text, foreground: colors.surface },
  error: { label: "Stopped", hint: "Tap to go back", background: colors.warning, foreground: colors.surface },
};
