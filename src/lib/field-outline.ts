import type { FieldPoint } from "@/contracts/accounts";

type Point = FieldPoint;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const area = (points: Point[]) => points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - q.x * p.y; }, 0) / 2;

function bounds(points: Point[]) {
  const left = Math.min(...points.map(p => p.x)), right = Math.max(...points.map(p => p.x));
  const top = Math.min(...points.map(p => p.y)), bottom = Math.max(...points.map(p => p.y));
  return { left, right, top, bottom, shortSide: Math.min(right - left, bottom - top) };
}

function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function simplifyLine(points: Point[], tolerance: number): Point[] {
  let maximum = tolerance, split = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const d = segmentDistance(points[i], points[0], points[points.length - 1]);
    if (d > maximum) { maximum = d; split = i; }
  }
  return split < 0 ? [points[0], points[points.length - 1]]
    : [...simplifyLine(points.slice(0, split + 1), tolerance).slice(0, -1), ...simplifyLine(points.slice(split), tolerance)];
}

function simpleRing(points: Point[]) {
  for (let i = 0; i < points.length; i++) for (let j = i + 2; j < points.length; j++) {
    if (i === 0 && j === points.length - 1) continue;
    const a = points[i], b = points[(i + 1) % points.length], c = points[j], d = points[(j + 1) % points.length];
    if (cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0
      && Math.max(a.x, b.x) >= Math.min(c.x, d.x) && Math.max(c.x, d.x) >= Math.min(a.x, b.x)
      && Math.max(a.y, b.y) >= Math.min(c.y, d.y) && Math.max(c.y, d.y) >= Math.min(a.y, b.y)) return false;
  }
  return true;
}

/** Presentation only: suppress raster steps without changing the saved, reviewed boundary. */
export function simplifyFieldOutline(points: Point[]): Point[] {
  if (points.length < 3) return points;
  const b = bounds(points), tolerance = b.shortSide * .04;
  const boxArea = (b.right - b.left) * (b.bottom - b.top);
  if (boxArea && Math.abs(area(points)) / boxArea > .965 && points.every(p =>
    Math.min(p.x - b.left, b.right - p.x, p.y - b.top, b.bottom - p.y) <= tolerance * 1.5)) {
    return [{ x: b.left, y: b.top }, { x: b.right, y: b.top }, { x: b.right, y: b.bottom }, { x: b.left, y: b.bottom }];
  }
  // Split at the farthest pair, so the seam and starting vertex do not affect simplification.
  let first = 0, opposite = 1, longest = 0;
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    const d = distance(points[i], points[j]);
    if (d > longest) { first = i; opposite = j; longest = d; }
  }
  const ring = [...points.slice(first), ...points.slice(0, first)];
  const split = opposite - first;
  const simplified = [...simplifyLine(ring.slice(0, split + 1), tolerance).slice(0, -1),
    ...simplifyLine([...ring.slice(split), ring[0]], tolerance).slice(0, -1)];
  const originalArea = area(points), simplifiedArea = area(simplified);
  return simplified.length >= 3 && simpleRing(simplified) && originalArea * simplifiedArea > 0
    && Math.abs(simplifiedArea / originalArea - 1) < .05 ? simplified : points;
}

/** SVG circular fillets, capped to avoid consuming adjacent short edges. */
export function roundedFieldPath(points: Point[]): string {
  if (points.length < 3) return "";
  const radius = bounds(points).shortSide * .26;
  const corners = points.map((p, i) => {
    const before = points[(i + points.length - 1) % points.length], after = points[(i + 1) % points.length];
    const a = distance(p, before), b = distance(p, after);
    if (!a || !b) return { entry: p, exit: p, radius: 0, sweep: 0 };
    const angle = Math.acos(Math.max(-1, Math.min(1, ((before.x - p.x) * (after.x - p.x) + (before.y - p.y) * (after.y - p.y)) / (a * b))));
    const tangent = Math.tan(angle / 2);
    const trim = Math.min(radius / Math.max(tangent, 1e-6), a * .45, b * .45);
    return { entry: { x: p.x + (before.x - p.x) * trim / a, y: p.y + (before.y - p.y) * trim / a },
      exit: { x: p.x + (after.x - p.x) * trim / b, y: p.y + (after.y - p.y) * trim / b },
      radius: angle < .01 || Math.PI - angle < .01 ? 0 : trim * tangent, sweep: cross(before, p, after) > 0 ? 1 : 0 };
  });
  const xy = (p: Point) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
  return corners.map((c, i) => `${i ? "L" : "M"}${xy(c.entry)} ${c.radius > .001 ? `A${c.radius.toFixed(3)},${c.radius.toFixed(3)} 0 0 ${c.sweep} ${xy(c.exit)}` : `L${xy(c.exit)}`}`).join(" ") + " Z";
}

export function signedFieldDistance(p: Point, points: Point[]) {
  let inside = false, nearest = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    nearest = Math.min(nearest, segmentDistance(p, a, b));
  }
  return (inside ? 1 : -1) * nearest;
}

/** Center the log marker in usable interior space, even for concave fields. */
export function fieldMarker(points: Point[], imageWidth: number) {
  const b = bounds(points), maxRadius = Math.min(imageWidth * 8.5 / 593.12, b.shortSide / 6);
  let center = { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
  let clearance = signedFieldDistance(center, points);
  if (clearance < maxRadius * 1.5) {
    let left = b.left, right = b.right, top = b.top, bottom = b.bottom;
    for (let pass = 0; pass < 4; pass++) {
      const stepX = (right - left) / 16, stepY = (bottom - top) / 16;
      for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) {
        const point = { x: left + (x + .5) * stepX, y: top + (y + .5) * stepY };
        const d = signedFieldDistance(point, points);
        if (d > clearance) { center = point; clearance = d; }
      }
      left = center.x - stepX; right = center.x + stepX; top = center.y - stepY; bottom = center.y + stepY;
    }
  }
  return { ...center, radius: Math.max(0, Math.min(maxRadius, clearance * .75)) };
}

export function fieldPresentation(boundary: Point[], width: number, height: number) {
  const points = simplifyFieldOutline(boundary.map(p => ({ x: p.x * width, y: p.y * height })));
  return { path: roundedFieldPath(points), marker: fieldMarker(points, width), points };
}
