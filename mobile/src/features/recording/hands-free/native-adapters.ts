/** The native side of hands-free mode. Loaded on the first session so the screens import no audio module up front. */
import { requestRecordingPermissionsAsync, setAudioModeAsync } from "expo-audio";
import * as Haptics from "expo-haptics";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { extractRecordingDetails } from "../transcribe";
import type { HandsFreePhase } from "./machine";
import { createSpeaker } from "./speaker";
import type { HandsFreeAdapters } from "./use-hands-free";
import { createVoiceApi } from "./voice-api";
import { createRealtimeConnector, loadWebRTC } from "./webrtc-adapter";

const keepAwakeTag = "toph-hands-free";
const haptics: Partial<Record<HandsFreePhase, () => Promise<void>>> = {
  // The strongest tap means "your turn to speak".
  listening: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  thinking: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  speaking: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
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
  };
}
