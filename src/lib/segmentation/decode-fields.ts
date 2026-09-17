import { preferSmallFields } from "./prefer-small-fields";
import type { FieldPoint } from "@/contracts/accounts";

export type ImageTransform = { left: number; top: number; width: number; height: number };
export type SegmentationTensor = { data: Float32Array; dims: readonly number[] };

type Proposal = { index: number; score: number; x1: number; y1: number; x2: number; y2: number };
const SIZE = 512;

function overlap(a: Proposal, b: Proposal) {
  const intersection = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  return intersection / ((a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - intersection);
}

function signedArea(points: FieldPoint[]) {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function simplify(points: FieldPoint[], tolerance: number): FieldPoint[] {
  if (points.length <= 2) return points;
  const first = points[0], last = points[points.length - 1];
  const dx = last.x - first.x, dy = last.y - first.y;
  let greatest = tolerance * tolerance, split = -1;
  for (let index = 1; index < points.length - 1; index++) {
    const point = points[index];
    const fraction = dx || dy ? Math.max(0, Math.min(1, ((point.x - first.x) * dx + (point.y - first.y) * dy) / (dx * dx + dy * dy))) : 0;
    const distance = (point.x - first.x - fraction * dx) ** 2 + (point.y - first.y - fraction * dy) ** 2;
    if (distance > greatest) { greatest = distance; split = index; }
  }
  return split < 0 ? [first, last] : [...simplify(points.slice(0, split + 1), tolerance).slice(0, -1), ...simplify(points.slice(split), tolerance)];
}

/** Largest exterior ring; disconnected islands and holes remain a manual review concern. */
export function maskToPolygon(mask: Uint8Array, width: number, height: number, transform: ImageTransform): FieldPoint[] {
  const stride = width + 1;
  const edges = new Map<number, number[]>();
  const add = (start: number, end: number) => edges.set(start, [...(edges.get(start) ?? []), end]);
  const filled = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height && mask[y * width + x] === 1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!filled(x, y)) continue;
    const topLeft = y * stride + x, topRight = topLeft + 1, bottomLeft = topLeft + stride, bottomRight = bottomLeft + 1;
    if (!filled(x, y - 1)) add(topLeft, topRight);
    if (!filled(x + 1, y)) add(topRight, bottomRight);
    if (!filled(x, y + 1)) add(bottomRight, bottomLeft);
    if (!filled(x - 1, y)) add(bottomLeft, topLeft);
  }
  let largest: FieldPoint[] = [], largestArea = 0;
  while (edges.size) {
    const start = edges.keys().next().value as number;
    let current = start;
    const ring: FieldPoint[] = [];
    do {
      ring.push({ x: current % stride, y: Math.floor(current / stride) });
      const destinations = edges.get(current);
      if (!destinations?.length) break;
      const next = destinations.pop()!;
      if (!destinations.length) edges.delete(current);
      current = next;
    } while (current !== start && ring.length <= (width + 1) * (height + 1));
    const area = current === start ? signedArea(ring) : 0;
    if (area > largestArea) { largestArea = area; largest = ring; }
  }
  if (largest.length < 3) return [];
  // Split a closed ring into two open paths before RDP; using identical endpoints
  // alone loses a closed shape. Return open rings, with the closing edge implicit.
  const split = Math.floor(largest.length / 2);
  let tolerance = 0.8;
  let reduced: FieldPoint[];
  do {
    reduced = [...simplify(largest.slice(0, split + 1), tolerance).slice(0, -1), ...simplify([...largest.slice(split), largest[0]], tolerance).slice(0, -1)];
    tolerance *= 1.5;
  } while (reduced.length > 200);
  return reduced.map(({ x, y }) => ({
    x: Math.max(0, Math.min(1, (x * SIZE / width - transform.left) / transform.width)),
    y: Math.max(0, Math.min(1, (y * SIZE / height - transform.top) / transform.height)),
  }));
}

/** Decode the pinned v2 ONNX heads. Scores are suggestions, never field ownership. */
export function decodeFieldPolygons(detections: SegmentationTensor, prototypes: SegmentationTensor, transform: ImageTransform): FieldPoint[][] {
  if (detections.dims.join(",") !== "1,37,5376" || prototypes.dims.join(",") !== "1,32,128,128") {
    throw new Error("The field model has an unsupported output shape. Draw fields manually while its configuration is checked.");
  }
  const count = detections.dims[2], data = detections.data, proposals: Proposal[] = [];
  for (let index = 0; index < count; index++) {
    const score = data[4 * count + index];
    if (!Number.isFinite(score) || score < 0.15) continue;
    const cx = data[index], cy = data[count + index], width = data[2 * count + index], height = data[3 * count + index];
    if (![cx, cy, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;
    proposals.push({ index, score, x1: cx - width / 2, y1: cy - height / 2, x2: cx + width / 2, y2: cy + height / 2 });
  }
  proposals.sort((a, b) => b.score - a.score);
  const selected: Proposal[] = [];
  for (const proposal of proposals) {
    if (selected.every((previous) => overlap(proposal, previous) <= 0.7)) selected.push(proposal);
    if (selected.length === 300) break;
  }
  const polygons: FieldPoint[][] = [];
  for (const proposal of selected) {
    const logits = new Float32Array(128 * 128);
    for (let channel = 0; channel < 32; channel++) {
      const coefficient = data[(channel + 5) * count + proposal.index];
      for (let pixel = 0; pixel < logits.length; pixel++) logits[pixel] += coefficient * prototypes.data[channel * logits.length + pixel];
    }
    const mask = new Uint8Array(SIZE * SIZE);
    let area = 0;
    for (let y = Math.max(0, Math.ceil(proposal.y1), transform.top); y < Math.min(SIZE, proposal.y2, transform.top + transform.height); y++) {
      for (let x = Math.max(0, Math.ceil(proposal.x1), transform.left); x < Math.min(SIZE, proposal.x2, transform.left + transform.width); x++) {
        const px = Math.max(0, Math.min(127, (x + 0.5) / 4 - 0.5)), py = Math.max(0, Math.min(127, (y + 0.5) / 4 - 0.5));
        const x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(127, x0 + 1), y1 = Math.min(127, y0 + 1), dx = px - x0, dy = py - y0;
        const value = (logits[y0 * 128 + x0] * (1 - dx) + logits[y0 * 128 + x1] * dx) * (1 - dy) + (logits[y1 * 128 + x0] * (1 - dx) + logits[y1 * 128 + x1] * dx) * dy;
        if (value > 0) { mask[y * SIZE + x] = 1; area++; }
      }
    }
    if (area < transform.width * transform.height * 0.001) continue;
    const polygon = maskToPolygon(mask, SIZE, SIZE, transform);
    if (polygon.length >= 3) polygons.push(polygon);
  }
  return preferSmallFields(polygons);
}
