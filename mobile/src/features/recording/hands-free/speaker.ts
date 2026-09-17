/** Speaks one prompt: the server's MP3 through expo-audio, or the device's own voice when that fails. */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { File, Paths } from "expo-file-system";
import * as Speech from "expo-speech";

export type Speaker = { speak(text: string): Promise<void>; stop(): Promise<void> };
type Options = { fetchSpeech(text: string): Promise<Uint8Array>; maxPlaybackMs?: number };

export function createSpeaker({ fetchSpeech, maxPlaybackMs = 45_000 }: Options): Speaker {
  // Repeated prompts ("What did you work on?") are fetched once per app launch.
  const cache = new Map<string, string>();
  let player: AudioPlayer | null = null;
  let finish: (() => void) | null = null;
  let utterance = 0;

  async function stop() {
    utterance += 1;
    const playing = player; player = null;
    try { playing?.pause(); playing?.remove(); } catch { /* already released */ }
    await Speech.stop().catch(() => undefined);
    finish?.(); finish = null;
  }

  async function serverAudio(text: string): Promise<string> {
    const cached = cache.get(text);
    if (cached && new File(cached).exists) return cached;
    const bytes = await fetchSpeech(text);
    const file = new File(Paths.cache, `toph-prompt-${Date.now()}-${cache.size}.mp3`);
    if (file.exists) file.delete();
    file.create();
    file.write(bytes);
    if (cache.size >= 24) cache.clear();
    cache.set(text, file.uri);
    return file.uri;
  }

  const onDevice = (text: string) => new Promise<void>(resolve => {
    finish = resolve;
    Speech.speak(text, { language: "en-US", onDone: resolve, onStopped: resolve, onError: () => resolve() });
  });

  return {
    stop,
    /** Resolves when playback has ended, so a recording that follows never contains the prompt. */
    async speak(text) {
      await stop();
      const mine = utterance;
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
      let uri: string;
      try { uri = await serverAudio(text); }
      catch {
        // Offline, rate limited (429) or not configured: the phone's own voice still asks the question.
        if (mine === utterance) await onDevice(text);
        return;
      }
      if (mine !== utterance) return;
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, maxPlaybackMs);
        finish = () => { clearTimeout(timer); resolve(); };
        try {
          const next = createAudioPlayer({ uri });
          player = next;
          next.addListener("playbackStatusUpdate", status => { if (status.didJustFinish) finish?.(); });
          next.play();
        } catch { finish(); }
      });
      if (mine !== utterance) return;
      const played = player; player = null; finish = null;
      try { played?.remove(); } catch { /* already released */ }
    },
  };
}
