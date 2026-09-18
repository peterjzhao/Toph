import { stitchCallAudio } from "../call-recording";

/** Little-endian PCM16, base64-encoded as `conversation.item.retrieved` delivers it. */
const pcm = (samples: number[]) => btoa(String.fromCharCode(...samples.flatMap(sample => [sample & 0xff, (sample >> 8) & 0xff])));
const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
function header(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    riff: ascii(bytes, 0, 4), wave: ascii(bytes, 8, 12), fmt: ascii(bytes, 12, 16), data: ascii(bytes, 36, 40),
    riffSize: view.getUint32(4, true), format: view.getUint16(20, true), channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true), byteRate: view.getUint32(28, true), blockAlign: view.getUint16(32, true),
    bits: view.getUint16(34, true), dataSize: view.getUint32(40, true),
  };
}
const samplesOf = (bytes: Uint8Array) => { const view = new DataView(bytes.buffer, bytes.byteOffset + 44, bytes.byteLength - 44); return Array.from({ length: view.byteLength / 2 }, (_, index) => view.getInt16(index * 2, true)); };

test("joins the worker's turns into one 24 kHz mono WAV with a second of silence between them", () => {
  const first = [1000, -1000, 32767], second = [-32768, 5];
  const recording = stitchCallAudio([pcm(first), pcm(second)])!;
  const gap = 24_000;
  expect(header(recording.bytes)).toEqual({
    riff: "RIFF", wave: "WAVE", fmt: "fmt ", data: "data", riffSize: 36 + (first.length + gap + second.length) * 2,
    format: 1, channels: 1, sampleRate: 24_000, byteRate: 48_000, blockAlign: 2, bits: 16, dataSize: (first.length + gap + second.length) * 2,
  });
  const samples = samplesOf(recording.bytes);
  expect(samples.slice(0, 3)).toEqual(first);
  expect(samples.slice(3, 3 + gap).every(sample => sample === 0)).toBe(true);
  expect(samples.slice(3 + gap)).toEqual(second);
  expect(recording).toMatchObject({ sampleRate: 24_000, durationSeconds: (first.length + gap + second.length) / 24_000 });
});

test("the quiet that voice detection leaves around each turn is trimmed, so the pause between turns is about a second", () => {
  const quiet = (count: number) => Array<number>(count).fill(12);
  const speech = Array.from({ length: 480 }, (_, index) => (index % 2 ? 9000 : -9000));
  // Half a second of lead-in and a second of tail around 20 ms of speech.
  const turn = pcm([...quiet(12_000), ...speech, ...quiet(24_000)]);
  const recording = stitchCallAudio([turn, turn])!;
  const margin = 3600; // 150 ms kept on each side
  const trimmed = margin + speech.length + margin;
  expect(recording.durationSeconds).toBeCloseTo((trimmed * 2 + 24_000) / 24_000, 5);
  const samples = samplesOf(recording.bytes);
  expect(samples.slice(margin, margin + speech.length)).toEqual(speech);
  expect(samples.slice(trimmed + 24_000 + margin, trimmed + 24_000 + margin + speech.length)).toEqual(speech);
  // A turn with nothing above the quiet level (a whisper) is kept whole rather than dropped.
  expect(stitchCallAudio([pcm(quiet(100))])!.durationSeconds).toBeCloseTo(100 / 24_000, 5);
});

test("one turn has no gap, and nothing to join is no recording", () => {
  const single = stitchCallAudio(["", pcm([7, 8])])!;
  expect(samplesOf(single.bytes)).toEqual([7, 8]);
  expect(stitchCallAudio([])).toBeNull();
  expect(stitchCallAudio(["", ""])).toBeNull();
});

test("a long call is averaged down to 12 kHz or 8 kHz so the log still fits the sync limit", () => {
  const turn = Array.from({ length: 24_000 }, (_, index) => (index % 2 ? 300 : 100));
  const full = 44 + (turn.length * 2 + 24_000) * 2;
  // One byte short of the full-rate WAV: every pair of samples becomes their average.
  const half = stitchCallAudio([pcm(turn), pcm(turn)], { maxBytes: full - 1 })!;
  expect(header(half.bytes).sampleRate).toBe(12_000);
  expect(half.bytes.byteLength).toBeLessThanOrEqual(full - 1);
  expect(samplesOf(half.bytes).slice(0, 3)).toEqual([200, 200, 200]);
  expect(half.durationSeconds).toBeCloseTo(3, 5);

  const third = stitchCallAudio([pcm(turn), pcm(turn)], { maxBytes: 44 + 40_000 })!;
  expect(header(third.bytes).sampleRate).toBe(8_000);
  expect(third.bytes.byteLength).toBeLessThanOrEqual(44 + 40_000);
  expect(third.durationSeconds).toBeCloseTo(2.5, 5);
  // Past what 8 kHz can hold, the end is cut rather than the log losing its recording.
  expect(third.durationSeconds).toBeLessThan(3);
});
