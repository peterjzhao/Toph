/**
 * A recording's own waveform, drawn like the design's (public/assets/waveform.svg): centred bars in
 * a 592 × 80.96 box that stretches to the player's width.
 */
import { useEffect, useState } from "react";

const BARS = 97; // as many as the design's waveform
const DECODE_RATE = 8000; // enough for the bars' envelope, at a fraction of full-rate memory
const WIDTH = 592;
const HEIGHT = 80.96;
const STROKE = 0.88;
const SHORTEST = 7.04; // the design's quiet bars
const TALLEST = 63.36; // the design's loudest bar

/** Each bar's loudest sample on any channel, as a fraction of the recording's loudest bar. */
export function waveformPeaks(channels: readonly ArrayLike<number>[], bars: number): number[] {
  const length = channels[0]?.length ?? 0;
  const peaks = Array.from({ length: bars }, (_, bar) => {
    const end = Math.floor((bar + 1) * length / bars);
    let peak = 0;
    for (const samples of channels) for (let index = Math.floor(bar * length / bars); index < end; index++) peak = Math.max(peak, Math.abs(samples[index]));
    return peak;
  });
  const loudest = Math.max(0, ...peaks);
  return loudest ? peaks.map(peak => peak / loudest) : peaks;
}

const round = (value: number) => Math.round(value * 100) / 100;

/** An SVG data URL of the peaks that can stand in for the design's waveform image. */
export function waveformImage(peaks: readonly number[]): string {
  const pitch = (WIDTH - STROKE) / Math.max(1, peaks.length - 1);
  const bars = peaks.map((peak, index) => {
    const x = round(STROKE / 2 + index * pitch);
    const half = (SHORTEST + peak * (TALLEST - SHORTEST)) / 2;
    return `<line x1="${x}" y1="${round(HEIGHT / 2 - half)}" x2="${x}" y2="${round(HEIGHT / 2 + half)}"/>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none" stroke="#003930" stroke-width="${STROKE}">${bars.join("")}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const drawn = new Map<string, Promise<string>>();

/** Downloads and decodes a recording once per page load, however often its log is opened. */
function drawRecording(url: string): Promise<string> {
  let image = drawn.get(url);
  if (!image) {
    image = (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`The recording could not be loaded (${response.status}).`);
      const audio = await new OfflineAudioContext(1, 1, DECODE_RATE).decodeAudioData(await response.arrayBuffer());
      return waveformImage(waveformPeaks(Array.from({ length: audio.numberOfChannels }, (_, channel) => audio.getChannelData(channel)), BARS));
    })();
    drawn.set(url, image);
    image.catch(() => drawn.delete(url)); // the next open tries again
  }
  return image;
}

/** The recording's waveform image; null without a URL, while it loads, or if the browser can't decode it. */
export function useRecordingWaveform(url: string | null): string | null {
  const [loaded, setLoaded] = useState<{ url: string; image: string } | null>(null);
  useEffect(() => {
    if (!url) return;
    let current = true;
    drawRecording(url).then(image => { if (current) setLoaded({ url, image }); }, () => {});
    return () => { current = false; };
  }, [url]);
  return loaded?.url === url ? loaded.image : null;
}
