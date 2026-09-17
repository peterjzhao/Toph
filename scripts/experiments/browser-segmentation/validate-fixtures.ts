import { readFileSync } from "node:fs";
import { decodeFieldPolygons } from "../../../src/lib/segmentation/decode-fields";
import { validateBoundary } from "../../../src/server/accounts/farm-setup";

// Real cached network heads from prepare.py, not manufactured test predictions.
// The react-server Node condition lets the actual backend validator be reused.
const read = (name: string, index: number) => {
  const bytes = readFileSync(`.local/browser-segmentation/site/samples/${name}-output${index}.bin`);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
};
let failures = 0;
for (const sample of ["salinas", "iowa-farm", "iowa"]) {
  const polygons = decodeFieldPolygons({ data: read(sample, 0), dims: [1, 37, 5376] }, { data: read(sample, 1), dims: [1, 32, 128, 128] }, { left: 0, top: 0, width: 512, height: 512 });
  const invalid = polygons.flatMap((polygon, index) => {
    try { validateBoundary(polygon); return []; }
    catch (error) { return [{ index, vertices: polygon.length, error: error instanceof Error ? error.message : String(error) }]; }
  });
  failures += invalid.length;
  console.log(JSON.stringify({ sample, polygons: polygons.length, maxVertices: Math.max(...polygons.map(polygon => polygon.length)), invalid }));
}
if (failures) process.exitCode = 1;
