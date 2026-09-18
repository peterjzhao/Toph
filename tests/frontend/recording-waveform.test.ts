import { describe, expect, it } from "vitest";
import { waveformImage, waveformPeaks } from "../../src/components/dashboard/recording-waveform";

function attributes(tag: string) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]));
}

/** Reads the drawn bars back out of a generated waveform image. */
function drawn(image: string) {
  const prefix = "data:image/svg+xml,";
  expect(image.startsWith(prefix)).toBe(true);
  const svg = decodeURIComponent(image.slice(prefix.length));
  const root = attributes(svg.slice(0, svg.indexOf(">")));
  const bars = [...svg.matchAll(/<line\b[^>]*>/g)].map(([tag]) => {
    const { x1, y1, x2, y2 } = attributes(tag);
    return { x: Number(x1), top: Number(y1), bottom: Number(y2), vertical: x1 === x2 };
  });
  return { root, bars };
}

describe("recording waveform peaks", () => {
  it("uses each bar's loudest sample of either sign on any channel, relative to the loudest bar", () => {
    const left = new Float32Array([0.125, -0.5, 0.25, 0]);
    const right = new Float32Array([0, 0.125, -0.375, 0.0625]);
    expect(waveformPeaks([left, right], 2)).toEqual([1, 0.75]);
  });

  it("spreads leftover samples into the bars instead of dropping the end of the recording", () => {
    expect(waveformPeaks([new Float32Array([0, 0, 0, 0, 0.5])], 2)).toEqual([0, 1]);
  });

  it("leaves a silent recording flat", () => {
    expect(waveformPeaks([new Float32Array(8)], 4)).toEqual([0, 0, 0, 0]);
  });
});

describe("recording waveform image", () => {
  it("stretches one vertical bar per peak edge to edge across the design's waveform box", () => {
    const { root, bars } = drawn(waveformImage([0, 0.5, 1]));
    expect(root.preserveAspectRatio).toBe("none");
    expect(root.viewBox).toBe("0 0 592 80.96");
    expect(bars.map(bar => bar.x)).toEqual([0.44, 296, 591.56]);
    expect(bars.every(bar => bar.vertical)).toBe(true);
  });

  it("centres the bars, keeping silence at the design's shortest bar and the loudest peak at its tallest", () => {
    const { bars } = drawn(waveformImage([0, 0.5, 1]));
    expect(bars.map(bar => [bar.top, bar.bottom])).toEqual([[36.96, 44], [22.88, 58.08], [8.8, 72.16]]);
  });
});
