import assert from "node:assert/strict";
import test from "node:test";
import { decodeFieldPolygons, maskToPolygon } from "../../../src/lib/segmentation/decode-fields";

const full = { left: 0, top: 0, width: 512, height: 512 };
const bounds = (points: Array<{ x: number; y: number }>) => [Math.min(...points.map((p) => p.x)), Math.min(...points.map((p) => p.y)), Math.max(...points.map((p) => p.x)), Math.max(...points.map((p) => p.y))];

test("an empty model mask creates no invented field", () => {
  assert.deepEqual(maskToPolygon(new Uint8Array(64), 8, 8, full), []);
});

test("rectangle boundaries use normalized original-image coordinates", () => {
  const mask = new Uint8Array(64);
  for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) mask[y * 8 + x] = 1;
  const polygon = maskToPolygon(mask, 8, 8, full);
  assert.equal(polygon.length, 4);
  assert.deepEqual(bounds(polygon), [0.25, 0.25, 0.75, 0.75]);
});

test("letterboxing is removed when mapping a non-square image", () => {
  const mask = new Uint8Array(64);
  for (let y = 2; y < 6; y++) for (let x = 0; x < 8; x++) mask[y * 8 + x] = 1;
  assert.deepEqual(bounds(maskToPolygon(mask, 8, 8, { left: 0, top: 128, width: 512, height: 256 })), [0, 0, 1, 1]);
});

test("largest exterior component wins and interior holes are not fields", () => {
  const mask = new Uint8Array(20 * 20);
  for (let y = 1; y < 12; y++) for (let x = 1; x < 12; x++) mask[y * 20 + x] = 1;
  for (let y = 4; y < 7; y++) for (let x = 4; x < 7; x++) mask[y * 20 + x] = 0;
  for (let y = 15; y < 18; y++) for (let x = 15; x < 18; x++) mask[y * 20 + x] = 1;
  assert.deepEqual(bounds(maskToPolygon(mask, 20, 20, full)), [0.05, 0.05, 0.6, 0.6]);
});

test("YOLO mask assembly suppresses duplicate boxes and excludes padding", () => {
  const count = 5376, detections = new Float32Array(37 * count), prototypes = new Float32Array(32 * 128 * 128);
  prototypes.fill(1, 0, 128 * 128);
  for (const [index, score] of [[0, 0.9], [1, 0.8]]) {
    detections[index] = 256; detections[count + index] = 256;
    detections[2 * count + index] = 512; detections[3 * count + index] = 512;
    detections[4 * count + index] = score; detections[5 * count + index] = 1;
  }
  const polygons = decodeFieldPolygons({ data: detections, dims: [1, 37, count] }, { data: prototypes, dims: [1, 32, 128, 128] }, { left: 0, top: 128, width: 512, height: 256 });
  assert.equal(polygons.length, 1);
  assert.deepEqual(bounds(polygons[0]), [0, 0, 1, 1]);
});

test("an incompatible model graph is rejected", () => {
  assert.throws(() => decodeFieldPolygons({ data: new Float32Array(), dims: [1, 38, 5376] }, { data: new Float32Array(), dims: [1, 32, 128, 128] }, full), /unsupported output shape/);
});
