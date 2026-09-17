"use client";

import type { FieldPoint } from "@/contracts/accounts";
import type { ImageTransform } from "./decode-fields";

export type FieldDetectionOptions = {
  onProgress: (text: string) => void;
  signal?: AbortSignal;
  /** A public, CORS-enabled URL for the exported FP32 512px v2 ONNX artifact. */
  modelUrl?: string;
};

export type FieldDetectionRequest = { pixels: Float32Array; transform: ImageTransform; modelUrl: string };
export type FieldDetectionMessage =
  | { type: "progress"; text: string }
  | { type: "result"; polygons: FieldPoint[][] }
  | { type: "error"; message: string };

export function supportsFieldDetection() {
  return typeof window !== "undefined" && typeof Worker !== "undefined" && typeof WebAssembly !== "undefined";
}

/** The image is processed only in this browser. No pixels are sent to a service. */
export async function detectFields(image: HTMLImageElement, options: FieldDetectionOptions): Promise<FieldPoint[][]> {
  if (!supportsFieldDetection()) throw new Error("This browser cannot run field detection. Try another browser.");
  if (options.signal?.aborted) throw new DOMException("Field detection cancelled.", "AbortError");
  if (!image.complete || !image.naturalWidth || !image.naturalHeight) throw new Error("Wait for the farm image to finish loading.");
  options.onProgress("Preparing the farm image on this device…");
  const size = 512, scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
  const width = Math.max(1, Math.round(image.naturalWidth * scale)), height = Math.max(1, Math.round(image.naturalHeight * scale));
  const transform = { left: Math.round((size - width) / 2 - 0.1), top: Math.round((size - height) / 2 - 0.1), width, height };
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser could not read the farm image. Try another image.");
  context.fillStyle = "rgb(114,114,114)";
  context.fillRect(0, 0, size, size);
  context.drawImage(image, transform.left, transform.top, width, height);
  const rgba = context.getImageData(0, 0, size, size).data;
  const pixels = new Float32Array(3 * size * size);
  for (let index = 0; index < size * size; index++) for (let channel = 0; channel < 3; channel++) pixels[channel * size * size + index] = rgba[index * 4 + channel] / 255;
  const configuredUrl = options.modelUrl?.trim() || process.env.NEXT_PUBLIC_FIELD_MODEL_URL?.trim() || "/models/delineate-v2-512-fp32.onnx";
  const modelUrl = new URL(configuredUrl, window.location.href).href;
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./segmentation.worker.ts", import.meta.url), { type: "module" });
    const finish = () => { worker.terminate(); options.signal?.removeEventListener("abort", abort); };
    const abort = () => { finish(); reject(new DOMException("Field detection cancelled.", "AbortError")); };
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<FieldDetectionMessage>) => {
      if (event.data.type === "progress") options.onProgress(event.data.text);
      else if (event.data.type === "result") { finish(); resolve(event.data.polygons); }
      else { finish(); reject(new Error(event.data.message)); }
    };
    worker.onerror = () => { finish(); reject(new Error("Field detection could not run on this device. Please try again.")); };
    worker.postMessage({ pixels, transform, modelUrl } satisfies FieldDetectionRequest, [pixels.buffer]);
    if (options.signal?.aborted) abort();
  });
}
