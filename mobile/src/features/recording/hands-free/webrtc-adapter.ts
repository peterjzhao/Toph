/**
 * Thin WebRTC adapter for the realtime call. `react-native-webrtc` is a native module that exists
 * only in a development or release build; in Expo Go, on web and under Jest it is absent, and
 * hands-free mode uses the turn-based transport instead.
 */
import type { VoiceSession } from "@toph/contracts/voice";

type WebRTC = typeof import("react-native-webrtc");
// The package's event typings come from a vendored shim that TypeScript cannot resolve here.
type Listenable = { addEventListener(type: string, listener: (event: { data?: unknown }) => void): void };
export type RealtimeCallbacks = {
  onOpen(): void;
  onMessage(data: unknown): void;
  /** The channel or the peer connection closed or failed after `connectRealtime` resolved or while it ran. */
  onDown(reason: string): void;
};
export type RealtimeCall = { send(event: Record<string, unknown>): void; close(): void };
export type ConnectRealtime = (session: VoiceSession, callbacks: RealtimeCallbacks, exchange: (offer: string) => Promise<string>) => Promise<RealtimeCall>;

/** Null when the native module is not part of this build. The import is guarded so the app still starts. */
export function loadWebRTC(): WebRTC | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  try { return require("react-native-webrtc") as WebRTC; }
  catch { return null; }
}

export function createRealtimeConnector(webrtc: WebRTC): ConnectRealtime {
  return async (session, callbacks, exchange) => {
    const { mediaDevices, RTCPeerConnection, RTCSessionDescription } = webrtc;
    let closed = false;
    const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
    const peer = new RTCPeerConnection();
    const channel = peer.createDataChannel(session.dataChannel);
    function close() {
      if (closed) return;
      closed = true;
      // Releasing the track turns the microphone off; closing the peer ends the billed call.
      try { channel.close(); } catch { /* already closed */ }
      try { stream.getTracks().forEach(track => track.stop()); stream.release(); } catch { /* already released */ }
      try { peer.close(); } catch { /* already closed */ }
    }
    const down = (reason: string) => { if (!closed) callbacks.onDown(reason); };
    try {
      stream.getTracks().forEach(track => peer.addTrack(track, stream));
      const channelEvents = channel as unknown as Listenable;
      channelEvents.addEventListener("open", () => { if (!closed) callbacks.onOpen(); });
      channelEvents.addEventListener("message", event => { if (!closed) callbacks.onMessage(event.data); });
      channelEvents.addEventListener("close", () => down("The voice call ended."));
      channelEvents.addEventListener("error", () => down("The voice call failed."));
      (peer as unknown as Listenable).addEventListener("connectionstatechange", () => {
        if (["failed", "disconnected", "closed"].includes(peer.connectionState)) down("The voice call was disconnected.");
      });
      // The remote audio track plays as soon as it arrives; there is nothing to attach.
      const offer = await peer.createOffer({});
      await peer.setLocalDescription(offer);
      const answer = await exchange(String(offer.sdp ?? peer.localDescription?.sdp ?? ""));
      if (closed) throw new Error("Cancelled.");
      await peer.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: answer }));
    } catch (cause) { close(); throw cause; }
    return {
      send(event) { if (!closed && channel.readyState === "open") channel.send(JSON.stringify(event)); },
      close,
    };
  };
}
