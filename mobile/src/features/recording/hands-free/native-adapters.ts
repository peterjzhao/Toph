/** The native side of hands-free mode. Loaded on the first session so the screens import no audio module up front. */
import { requestRecordingPermissionsAsync, setAudioModeAsync } from "expo-audio";
import { File, Paths } from "expo-file-system";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { extractRecordingDetails } from "../transcribe";
import type { HandsFreePhase } from "./machine";
import { createSpeaker } from "./speaker";
import type { HandsFreeAdapters } from "./use-hands-free";
import { createVoiceApi } from "./voice-api";
import { createRealtimeConnector, loadWebRTC } from "./webrtc-adapter";

const keepAwakeTag = "toph-hands-free";
type HapticsModule = typeof import("expo-haptics");
/** Null when the native module is not part of this build; sessions then run without taps. */
function loadHaptics(): HapticsModule | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  try { return require("expo-haptics") as HapticsModule; }
  catch { return null; }
}
const Haptics = loadHaptics();
const haptics: Partial<Record<HandsFreePhase, () => Promise<void>>> = !Haptics ? {} : {
  // The strongest tap means "your turn to speak".
  listening: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  thinking: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  speaking: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  // Felt the moment the call hangs up, so the phone can go back in the pocket.
  saving: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  saved: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
};

export function createNativeAdapters(): HandsFreeAdapters {
  const api = createVoiceApi();
  const webrtc = loadWebRTC();
  return {
    api,
    speaker: createSpeaker({ fetchSpeech: text => api.speech(text) }),
    connect: webrtc ? createRealtimeConnector(webrtc) : null,
    extract: (transcript, context) => extractRecordingDetails(transcript, { context }),
    requestMicrophone: async () => (await requestRecordingPermissionsAsync()).granted,
    // Play-and-record with the loudspeaker as the default route; the worker is not holding the phone.
    prepareCallAudio: () => setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldRouteThroughEarpiece: false }).catch(() => undefined),
    haptic: phase => { void haptics[phase]?.().catch(() => undefined); },
    keepAwake: on => { void (on ? activateKeepAwakeAsync(keepAwakeTag) : deactivateKeepAwake(keepAwakeTag)).catch(() => undefined); },
    // Beside the recorder's own files; saving the draft copies it into the draft's folder.
    writeRecording: wav => {
      const file = new File(Paths.cache, `call-${Date.now()}.wav`);
      file.create({ overwrite: true });
      file.write(wav);
      return { uri: file.uri, mimeType: "audio/wav", extension: "wav" };
    },
  };
}
