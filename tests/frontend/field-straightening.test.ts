import { expect, test } from "vitest";
import { maskToPolygon } from "../../src/lib/segmentation/decode-fields";

const SIZE = 512, full = { left: 0, top: 0, width: SIZE, height: SIZE };
function mask(inside: (x: number, y: number) => boolean) {
  const data = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (inside(x, y)) data[y * SIZE + x] = 1;
  return data;
}

test("straightens wavy mask edges into a four-corner field", () => {
  // A 200px square whose edges wander by ±3px, like a soft segmentation mask.
  const wobble = (along: number) => Math.round(3 * Math.sin(along / 9));
  const polygon = maskToPolygon(mask((x, y) => x >= 150 + wobble(y) && x < 350 + wobble(y + 40) && y >= 150 + wobble(x) && y < 350 + wobble(x + 40)), SIZE, SIZE, full);
  expect(polygon.length).toBeLessThanOrEqual(6);
  const xs = polygon.map(point => point.x * SIZE), ys = polygon.map(point => point.y * SIZE);
  expect(Math.min(...xs)).toBeGreaterThan(140); expect(Math.max(...xs)).toBeLessThan(360);
  expect(Math.min(...ys)).toBeGreaterThan(140); expect(Math.max(...ys)).toBeLessThan(360);
});

test("keeps real corners of a concave field", () => {
  const polygon = maskToPolygon(mask((x, y) => x >= 100 && x < 400 && y >= 100 && y < 400 && !(x >= 250 && y >= 250)), SIZE, SIZE, full);
  expect(polygon).toHaveLength(6);
});
