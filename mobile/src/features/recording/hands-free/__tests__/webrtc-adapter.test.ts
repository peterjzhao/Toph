import { allowLargeMessages, createRealtimeConnector, type loadWebRTC } from "../webrtc-adapter";

const offer = ["v=0", "m=audio 9 UDP/TLS/RTP/SAVPF 111", "a=rtpmap:111 opus/48000/2", "m=application 9 UDP/DTLS/SCTP webrtc-datachannel", "a=sctp-port:5000", "a=max-message-size:262144", ""].join("\r\n");

test("the offer tells OpenAI the phone accepts a whole spoken turn in one data-channel message", () => {
  expect(allowLargeMessages(offer)).toContain("a=max-message-size:4194304\r\n");
  expect(allowLargeMessages(offer)).not.toContain("262144");
  // An offer without the attribute defaults to 64 KB on the far side, so it is added.
  const bare = offer.replace("a=max-message-size:262144\r\n", "");
  expect(allowLargeMessages(bare)).toContain("a=sctp-port:5000\r\na=max-message-size:4194304\r\n");
  // No data channel: nothing to change.
  expect(allowLargeMessages("v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n")).toBe("v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n");
});

test("the call sends the enlarged offer and can mute the microphone without hanging up", async () => {
  const track = { enabled: true, stop: jest.fn() };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track], release: jest.fn() };
  const channel = { readyState: "open", send: jest.fn(), close: jest.fn(), addEventListener: jest.fn() };
  const peer = {
    connectionState: "new", localDescription: null,
    createDataChannel: jest.fn(() => channel), addTrack: jest.fn(), addEventListener: jest.fn(), close: jest.fn(),
    createOffer: jest.fn(async () => ({ sdp: offer })), setLocalDescription: jest.fn(async () => {}), setRemoteDescription: jest.fn(async () => {}),
  };
  const webrtc = {
    mediaDevices: { getUserMedia: jest.fn(async () => stream) },
    RTCPeerConnection: jest.fn(() => peer),
    RTCSessionDescription: jest.fn((description: unknown) => description),
  } as unknown as NonNullable<ReturnType<typeof loadWebRTC>>;
  const exchange = jest.fn(async (_offer: string) => "answer-sdp");
  const call = await createRealtimeConnector(webrtc)("oai-events", { onOpen: jest.fn(), onMessage: jest.fn(), onDown: jest.fn() }, exchange);
  expect(exchange.mock.calls[0][0]).toContain("a=max-message-size:4194304");
  // The phone's own description is left as the browser engine wrote it.
  expect(peer.setLocalDescription).toHaveBeenCalledWith({ sdp: offer });

  call.mute();
  expect(track.enabled).toBe(false);
  expect(track.stop).not.toHaveBeenCalled();
  expect(peer.close).not.toHaveBeenCalled();
  call.close();
  expect(track.stop).toHaveBeenCalled();
  expect(peer.close).toHaveBeenCalled();
});
