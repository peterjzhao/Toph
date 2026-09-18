/**
 * The recording of a realtime call. WebRTC owns the microphone during a call, so nothing is recorded on
 * the phone; OpenAI keeps each of the worker's turns after noise reduction and voice detection, and the
 * relay fetches them with `conversation.item.retrieve` as base64 PCM16. This joins those turns into one
 * WAV, a second of silence between turns so the back-and-forth stays easy to follow. Pure: the caller
 * writes the bytes to a file.
 */

/** The session's input format (`audio/pcm`, 24 kHz mono), which is the format retrieved turns come back in. */
export const REALTIME_SAMPLE_RATE = 24_000;
export type CallRecording = { bytes: Uint8Array; sampleRate: number; durationSeconds: number };
type StitchOptions = {
  /** The log's audio limit. A long call is averaged down to 12 or 8 kHz to fit, and cut at the end past that. */
  maxBytes?: number;
  gapSeconds?: number;
};
const headerBytes = 44;
/** About -40 dBFS. Quieter samples at a turn's edges are the pause voice detection keeps around speech. */
const quietLevel = 328;
/** Kept around the speech so soft first and last sounds survive: 150 ms. */
const marginSamples = 3600;

function decode(base64: string) {
  const binary = atob(base64);
  // A trailing odd byte is half a sample.
  const bytes = new Uint8Array(binary.length & ~1);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function wav(data: Uint8Array, sampleRate: number) {
  const bytes = new Uint8Array(headerBytes + data.byteLength);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => { for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index); };
  text(0, "RIFF"); view.setUint32(4, 36 + data.byteLength, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, data.byteLength, true);
  bytes.set(data, headerBytes);
  return bytes;
}

/**
 * Voice detection returns a turn with the silence before and after it (half a second to a few seconds),
 * which would stretch every one-second gap. A turn with nothing above the quiet level is kept whole.
 */
function trim(pcm: Uint8Array) {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const samples = pcm.byteLength / 2;
  const loud = (index: number) => Math.abs(view.getInt16(index * 2, true)) > quietLevel;
  let first = 0;
  while (first < samples && !loud(first)) first += 1;
  if (first === samples) return pcm;
  let last = samples - 1;
  while (!loud(last)) last -= 1;
  return pcm.subarray(Math.max(0, first - marginSamples) * 2, Math.min(samples, last + 1 + marginSamples) * 2);
}

/** Averages each run of `factor` samples: a plain low-pass before dropping to a lower rate. */
function decimate(pcm: Uint8Array, factor: number, maxSamples: number) {
  const input = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const count = Math.min(Math.floor(pcm.byteLength / 2 / factor), maxSamples);
  const out = new Uint8Array(count * 2);
  const output = new DataView(out.buffer);
  for (let sample = 0; sample < count; sample += 1) {
    let sum = 0;
    for (let offset = 0; offset < factor; offset += 1) sum += input.getInt16((sample * factor + offset) * 2, true);
    output.setInt16(sample * 2, Math.round(sum / factor), true);
  }
  return out;
}

/** Null when no turn has any audio. */
export function stitchCallAudio(segments: string[], { maxBytes = Infinity, gapSeconds = 1 }: StitchOptions = {}): CallRecording | null {
  const turns = segments.filter(Boolean).map(decode).filter(bytes => bytes.byteLength > 0).map(trim);
  if (!turns.length) return null;
  const gap = Math.round(gapSeconds * REALTIME_SAMPLE_RATE) * 2;
  const pcm = new Uint8Array(turns.reduce((total, turn) => total + turn.byteLength, 0) + gap * (turns.length - 1));
  // The gaps are the array's own zeros.
  turns.reduce((offset, turn) => { pcm.set(turn, offset); return offset + turn.byteLength + gap; }, 0);

  const budget = Math.floor((maxBytes - headerBytes) / 2);
  if (budget <= 0) return null;
  const factor = [1, 2, 3].find(candidate => pcm.byteLength / 2 / candidate <= budget) ?? 3;
  const data = factor === 1 ? pcm : decimate(pcm, factor, budget);
  const sampleRate = REALTIME_SAMPLE_RATE / factor;
  return { bytes: wav(data, sampleRate), sampleRate, durationSeconds: data.byteLength / 2 / sampleRate };
}
