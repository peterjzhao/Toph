import "server-only";
/**
 * Sentinel-2 evalscripts.
 *
 * Scene Classification (SCL) values that are not ground: 0 no data, 1 saturated or defective,
 * 3 cloud shadow, 8 and 9 cloud at medium and high probability, 10 thin cirrus, 11 snow and ice.
 * These are excluded from statistics. They are deliberately NOT hidden in the pictures: a farmer
 * looking at a frame should see the cloud that explains a gap, rather than a doctored clear day.
 */

import type { Layer } from "@/contracts/satellite";

const TRUE_COLOUR = `//VERSION=3
function setup() {
  return { input: ["B02", "B03", "B04", "dataMask"], output: { bands: 4 } };
}
function evaluatePixel(sample) {
  const gain = 2.5;
  return [sample.B04 * gain, sample.B03 * gain, sample.B02 * gain, sample.dataMask];
}`;

/** Near infrared in the red channel: healthy vegetation reads bright red, bare soil grey-blue. */
const INFRARED = `//VERSION=3
function setup() {
  return { input: ["B03", "B04", "B08", "dataMask"], output: { bands: 4 } };
}
function evaluatePixel(sample) {
  const gain = 2.5;
  return [sample.B08 * gain, sample.B04 * gain, sample.B03 * gain, sample.dataMask];
}`;

const NDVI_IMAGE = `//VERSION=3
function setup() {
  return { input: ["B04", "B08", "dataMask"], output: { bands: 4 } };
}
const ramp = [
  [-0.2, [0.75, 0.75, 0.75]],
  [0.0, [0.86, 0.80, 0.64]],
  [0.2, [0.85, 0.79, 0.38]],
  [0.4, [0.56, 0.75, 0.29]],
  [0.6, [0.27, 0.58, 0.20]],
  [0.8, [0.10, 0.36, 0.12]],
];
function evaluatePixel(sample) {
  const total = sample.B08 + sample.B04;
  const ndvi = total === 0 ? 0 : (sample.B08 - sample.B04) / total;
  let colour = ramp[0][1];
  for (let index = 0; index < ramp.length; index++) {
    if (ndvi >= ramp[index][0]) colour = ramp[index][1];
  }
  return [colour[0], colour[1], colour[2], sample.dataMask];
}`;

const IMAGE_EVALSCRIPTS: Record<Layer, string> = { "true-colour": TRUE_COLOUR, infrared: INFRARED, ndvi: NDVI_IMAGE };
export const imageEvalscript = (layer: Layer): string => IMAGE_EVALSCRIPTS[layer];

/**
 * NDVI for statistics. dataMask carries the cloud test, so the reported mean is taken over
 * cloud-free ground only, and the surviving pixel count tells us how much of the field that was.
 */
export const NDVI_STATISTICS_EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B08", "SCL", "dataMask"] }],
    output: [
      { id: "ndvi", bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1 }
    ]
  };
}
function evaluatePixel(sample) {
  const scl = sample.SCL;
  const notGround = scl === 0 || scl === 1 || scl === 3 || scl === 8 || scl === 9 || scl === 10 || scl === 11;
  const total = sample.B08 + sample.B04;
  const ndvi = total === 0 ? 0 : (sample.B08 - sample.B04) / total;
  return { ndvi: [ndvi], dataMask: [sample.dataMask === 1 && !notGround ? 1 : 0] };
}`;
