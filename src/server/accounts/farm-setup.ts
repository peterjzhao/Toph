import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FieldPoint, FarmSetup } from "@/contracts/accounts";
import type { AccountContext } from "./service";
import { ApiError, validationError } from "@/server/errors";
import { parseInput } from "./validation";
import { parseFarmExtent } from "@/server/satellite/extent";

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** Where the signed-in account's farm aerial is served (src/app/api/farm/image/route.ts). */
export const FARM_IMAGE_URL = "/api/farm/image";
const point = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict();
const setupSchema = z.object({
  // `bbox` is present only when the view came from the map picker; an uploaded image has no trusted extent.
  image: z.object({ dataUrl: z.string().max(2_800_000), width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192), bbox: z.string().max(100).optional() }).strict().optional(),
  fields: z.array(z.object({ id: z.string().uuid().optional(), label: z.string().regex(/^[A-Z]$/), boundary: z.array(point).min(3).max(200) }).strict()).min(1).max(26),
}).strict();

function cross(a: FieldPoint, b: FieldPoint, c: FieldPoint) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
function onSegment(a: FieldPoint, b: FieldPoint, c: FieldPoint) {
  return Math.abs(cross(a, b, c)) < 1e-10 && c.x >= Math.min(a.x, b.x) && c.x <= Math.max(a.x, b.x) && c.y >= Math.min(a.y, b.y) && c.y <= Math.max(a.y, b.y);
}
function intersects(a: FieldPoint, b: FieldPoint, c: FieldPoint, d: FieldPoint) {
  return (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}
export function validateBoundary(points: FieldPoint[]): void {
  const area = Math.abs(points.reduce((sum, a, index) => { const b = points[(index + 1) % points.length]; return sum + a.x * b.y - b.x * a.y; }, 0)) / 2;
  if (area <= 0.0001) throw validationError("Each field must enclose a visible area.");
  if (new Set(points.map(p => `${p.x},${p.y}`)).size !== points.length) throw validationError("A field boundary contains repeated points.");
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
    if (intersects(points[i], points[(i + 1) % points.length], points[j], points[(j + 1) % points.length])) throw validationError("Field boundaries must not cross themselves.");
  }
}

/** Read dimensions from the raster header, never trust caller-supplied dimensions or MIME. */
export function imageDimensions(bytes: Buffer, mime: string): { width: number; height: number } | null {
  if (mime === "image/png" && bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString("ascii", 12, 16) === "IHDR") {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) return null;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) return null;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) return null;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) return null;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && length >= 8) return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
      offset += length;
    }
  }
  if (mime === "image/webp" && bytes.length >= 30 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    const kind = bytes.toString("ascii", 12, 16);
    if (kind === "VP8X") return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
    if (kind === "VP8 " && bytes.subarray(23, 26).equals(Buffer.from([157,1,42]))) return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (kind === "VP8L" && bytes[20] === 47) return { width: 1 + (((bytes[22] & 63) << 8) | bytes[21]), height: 1 + (((bytes[24] & 15) << 10) | (bytes[23] << 2) | ((bytes[22] & 192) >> 6)) };
  }
  return null;
}

function parseImage(image: NonNullable<z.infer<typeof setupSchema>["image"]>) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl);
  if (!match) throw validationError("Choose a JPEG, PNG or WebP farm image.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64") !== match[2]) throw validationError("Keep the farm image under 2 MB.");
  const dimensions = imageDimensions(bytes, match[1]);
  if (!dimensions || dimensions.width !== image.width || dimensions.height !== image.height) throw validationError("The image dimensions do not match the uploaded image.");
  return { bytes, mime: match[1], width: image.width, height: image.height };
}

/** The map picker's own view, revalidated against the shared extent bounds. */
function parseExtent(bbox: string) {
  const parts = bbox.split(",").map(Number);
  if (parts.length !== 4) throw validationError("Choose a map view to capture.");
  return parseFarmExtent({ minX: parts[0], minY: parts[1], maxX: parts[2], maxY: parts[3], source: "capture" });
}

export async function getFarmSetup(ctx: AccountContext): Promise<FarmSetup> {
  const [images, fields] = await Promise.all([
    ctx.sql`select width, height from toph.farm_images where farm_id = ${ctx.farmId}`,
    ctx.sql`select id, label, boundary from toph.fields where farm_id = ${ctx.farmId} and boundary is not null order by label`,
  ]);
  return { image: images[0] ? { url: FARM_IMAGE_URL, width: images[0].width, height: images[0].height } : null,
    fields: fields.map(field => ({ id: field.id, label: field.label, boundary: typeof field.boundary === "string" ? JSON.parse(field.boundary) : field.boundary })),
    setupComplete: ctx.session.farm.setupComplete };
}

export async function saveFarmSetup(ctx: AccountContext, body: unknown): Promise<FarmSetup> {
  const input = parseInput(setupSchema, body);
  if (new Set(input.fields.map(field => field.label)).size !== input.fields.length) throw validationError("Assign each field a different letter from A to Z.");
  for (const field of input.fields) validateBoundary(field.boundary);
  const image = input.image ? parseImage(input.image) : null;
  // Re-validated here rather than trusted: a client cannot widen the accepted bounds.
  const extent = input.image?.bbox ? parseExtent(input.image.bbox) : null;
  await ctx.sql.begin(async tx => {
    await tx`select farm_id from toph.farm_access where farm_id = ${ctx.farmId} for update`;
    const [existingImage] = await tx`select farm_id from toph.farm_images where farm_id = ${ctx.farmId}`;
    if (!image && !existingImage) throw validationError("Upload your farm image before confirming fields.");
    const existing = await tx<{ id: string; label: string | null }[]>`select id, label from toph.fields where farm_id = ${ctx.farmId}`;
    const ids = new Set<string>();
    const confirmed = input.fields.map(field => {
      if (field.id && !existing.some(saved => saved.id === field.id)) throw validationError("A field does not belong to this farm.");
      const id = field.id ?? existing.find(saved => saved.label === field.label)?.id ?? randomUUID();
      if (ids.has(id)) throw validationError("Choose each field only once.");
      ids.add(id);
      return { ...field, id };
    });
    const used = await tx<{ field_id: string }[]>`select distinct field_id from toph.work_logs where farm_id = ${ctx.farmId}`;
    if (used.some(row => !ids.has(row.field_id))) throw new ApiError(409, "REVISION_CONFLICT", "Fields with recorded work must remain on the farm map.");
    if (image && existingImage && used.length) throw new ApiError(409, "REVISION_CONFLICT", "This farm image has recorded work. Keep it to preserve the original field locations.");
    // The extent is written with the image every time, so replacing an aerial can never leave the
    // previous raster's coordinates attached to a different picture.
    if (image) await tx`insert into toph.farm_images (farm_id, mime_type, bytes, width, height, extent_min_x, extent_min_y, extent_max_x, extent_max_y, extent_source)
      values (${ctx.farmId}, ${image.mime}, ${image.bytes}, ${image.width}, ${image.height},
        ${extent?.minX ?? null}, ${extent?.minY ?? null}, ${extent?.maxX ?? null}, ${extent?.maxY ?? null}, ${extent?.source ?? null})
      on conflict (farm_id) do update set mime_type = excluded.mime_type, bytes = excluded.bytes, width = excluded.width, height = excluded.height,
        extent_min_x = excluded.extent_min_x, extent_min_y = excluded.extent_min_y, extent_max_x = excluded.extent_max_x,
        extent_max_y = excluded.extent_max_y, extent_source = excluded.extent_source, updated_at = now()`;
    // Vacate labels before applying edits so swapping A/B is atomic and preserves field IDs.
    await tx`update toph.fields set label = null where farm_id = ${ctx.farmId}`;
    await tx`delete from toph.fields where farm_id = ${ctx.farmId} and not (id = any(${[...ids]}::uuid[]))`;
    for (const field of confirmed) await tx`insert into toph.fields (id, farm_id, name, label, boundary)
      values (${field.id}, ${ctx.farmId}, ${`FIELD ${field.label}`}, ${field.label}, ${JSON.stringify(field.boundary)}::jsonb)
      on conflict (id) do update set name = excluded.name, label = excluded.label, boundary = excluded.boundary, updated_at = now()`;
    await tx`update toph.farm_access set setup_complete = true where farm_id = ${ctx.farmId}`;
  });
  return getFarmSetup({ ...ctx, session: { ...ctx.session, farm: { ...ctx.session.farm, setupComplete: true } } });
}
