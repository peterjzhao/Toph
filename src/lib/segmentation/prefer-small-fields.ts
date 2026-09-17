import type { FieldPoint } from "@/contracts/accounts";

const GRID = 256;

/** Rasterize polygon interiors, not bounding boxes: concave outlines can surround empty space. */
function rasterize(polygon: FieldPoint[]) {
  const mask = new Uint8Array(GRID * GRID);
  const pixels: number[] = [];
  for (let row = 0; row < GRID; row++) {
    const y = (row + .5) / GRID;
    const crossings: number[] = [];
    for (let index = 0; index < polygon.length; index++) {
      const a = polygon[index], b = polygon[(index + 1) % polygon.length];
      if ((a.y > y) !== (b.y > y)) crossings.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
    }
    crossings.sort((a, b) => a - b);
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      const left = Math.max(0, Math.ceil(crossings[index] * GRID - .5));
      const right = Math.min(GRID, Math.ceil(crossings[index + 1] * GRID - .5));
      for (let col = left; col < right; col++) { const pixel = row * GRID + col; mask[pixel] = 1; pixels.push(pixel); }
    }
  }
  return { mask, pixels };
}

/**
 * Drop a merged proposal when it contains at least two distinct smaller proposals.
 * Keep isolated large fields and duplicate/nested predictions of just one small field.
 * Raster overlap tolerates small model edge differences (90% containment); children must
 * overlap by at most 25% of the smaller child to count as separate fields.
 */
export function preferSmallFields(polygons: FieldPoint[][]): FieldPoint[][] {
  const regions = polygons.map(rasterize);
  const overlap = (a: number, b: number) => regions[a].pixels.reduce((sum, pixel) => sum + regions[b].mask[pixel], 0);
  return polygons.filter((_, parent) => {
    const children = regions.flatMap((child, index) => index !== parent && child.pixels.length > 0 && regions[parent].pixels.length >= child.pixels.length * 1.25 && overlap(index, parent) >= child.pixels.length * .9 ? [index] : []);
    for (let a = 0; a < children.length; a++) for (let b = a + 1; b < children.length; b++) {
      const smaller = Math.min(regions[children[a]].pixels.length, regions[children[b]].pixels.length);
      if (overlap(children[a], children[b]) <= smaller * .25) return false;
    }
    return true;
  });
}
