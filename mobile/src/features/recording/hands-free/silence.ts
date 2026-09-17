/** Decides when a hands-free clip ends, from the recorder's input level. Pure and tunable. */
export type SilenceOptions = {
  /** Level (dB) at or above which the worker is taken to be speaking. */
  speechDb: number;
  /** Level (dB) below which the input counts as silence. */
  silenceDb: number;
  /** Speech needed before trailing silence may end the clip. */
  minSpeechMs: number;
  /** Trailing silence that ends the clip. */
  silenceMs: number;
  /** Give up when nobody has spoken for this long. */
  noSpeechMs: number;
  maxClipMs: number;
  /** Clip length when the platform reports no input level at all. */
  unmeteredClipMs: number;
};
export const defaultSilence: SilenceOptions = { speechDb: -32, silenceDb: -42, minSpeechMs: 300, silenceMs: 1800, noSpeechMs: 8000, maxClipMs: 40_000, unmeteredClipMs: 12_000 };
/** "empty" means nothing was said, so the clip should not be uploaded. */
export type SilenceVerdict = "continue" | "stop" | "empty";

export function createSilenceDetector(options: Partial<SilenceOptions> = {}) {
  const config = { ...defaultSilence, ...options };
  let last: number | null = null, speech = 0, quiet = 0, metered = false;
  return {
    /** Feed the latest level and the clip's elapsed time; samples may arrive at any rate. */
    push(decibels: number | null, elapsedMs: number): SilenceVerdict {
      const step = last === null ? 0 : Math.max(0, elapsedMs - last);
      last = elapsedMs;
      if (decibels !== null) {
        metered = true;
        if (decibels >= config.speechDb) { speech += step; quiet = 0; }
        else if (decibels < config.silenceDb) quiet += step;
      }
      const spoke = speech >= config.minSpeechMs;
      if (!metered) return elapsedMs >= config.unmeteredClipMs ? "stop" : "continue";
      if (spoke && quiet >= config.silenceMs) return "stop";
      if (!spoke && elapsedMs >= config.noSpeechMs) return "empty";
      return elapsedMs >= config.maxClipMs ? "stop" : "continue";
    },
  };
}
