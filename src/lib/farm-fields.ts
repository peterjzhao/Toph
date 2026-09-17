export type FieldPoint = { x: number; y: number };
export type DraftField = { id?: string; label: string; boundary: FieldPoint[] };
export const FIELD_LABELS = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index));
export function nextFieldLabel(fields: DraftField[]): string | undefined {
  return FIELD_LABELS.find(label => !fields.some(field => field.label === label));
}
export function polygonArea(points: FieldPoint[]): number {
  return Math.abs(points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
}
export function validFieldBoundary(points: FieldPoint[]): boolean {
  return points.length >= 3 && points.length <= 200 && points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1) && polygonArea(points) > .0001;
}

/** Decode and resize locally; only the explicitly saved raster is sent to the farm API. */
export async function prepareFarmImage(file: File): Promise<{ dataUrl: string; width: number; height: number }> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPEG, PNG, or WebP image.");
  if (file.size > 20 * 1024 * 1024) throw new Error("Choose an image smaller than 20 MB.");
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    await image.decode().catch(() => { throw new Error("This image couldn’t be opened. Try a different file."); });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("The image is empty.");
    const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser couldn’t prepare this image.");
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let dataUrl = canvas.toDataURL("image/jpeg", .9);
    if (dataUrl.length > 2_600_000) dataUrl = canvas.toDataURL("image/jpeg", .7);
    if (dataUrl.length > 2_600_000) throw new Error("This image is too detailed to save. Try a smaller image.");
    return { dataUrl, width: canvas.width, height: canvas.height };
  } finally { URL.revokeObjectURL(source); }
}
