import { decodeFieldPolygons } from "./decode-fields";
import type { FieldDetectionMessage, FieldDetectionRequest } from "./detect-fields";

// This worker has no API client or image upload path. Only public model/runtime
// artifacts are fetched; inference and polygon extraction stay on the device.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<FieldDetectionRequest>) => void) | null;
  postMessage: (message: FieldDetectionMessage) => void;
  navigator: Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } };
};
const progress = (text: string) => scope.postMessage({ type: "progress", text });

async function loadModel(url: string): Promise<Uint8Array> {
  const cache = typeof caches === "undefined" ? undefined : await caches.open("toph-field-model-v2-fp32").catch(() => undefined);
  const cached = await cache?.match(url);
  if (cached) { progress("Loading the field detector saved on this device…"); return new Uint8Array(await cached.arrayBuffer()); }
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) throw new Error("Automatic field detection is not available yet. You can draw fields manually and continue setting up your farm.");
  const total = Number(response.headers.get("content-length"));
  if (total > 320_000_000) throw new Error("The configured field model is too large. You can draw fields manually instead.");
  let bytes: Uint8Array<ArrayBuffer>;
  if (response.body) {
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let loaded = 0, lastReportedMb = -1;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      if (loaded > 320_000_000) { await reader.cancel(); throw new Error("The field model exceeds this browser's download limit."); }
      chunks.push(value);
      const mb = Math.floor(loaded / 1_000_000);
      if (mb !== lastReportedMb) { progress(`Downloading the field detector: ${mb}${total ? ` / ${Math.ceil(total / 1_000_000)}` : ""} MB…`); lastReportedMb = mb; }
    }
    bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  } else bytes = new Uint8Array(await response.arrayBuffer());
  // Storage quotas/private browsing may disallow caching; inference can still run.
  await cache?.put(url, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } })).catch(() => undefined);
  return bytes;
}

scope.onmessage = async ({ data }) => {
  let session: import("onnxruntime-web").InferenceSession | undefined;
  let input: import("onnxruntime-web").Tensor | undefined;
  let outputs: Record<string, import("onnxruntime-web").Tensor> | undefined;
  try {
    const ort = await import("onnxruntime-web/webgpu");
    ort.env.wasm.numThreads = 1;
    // Keep runtime glue/WASM version matched to the package; model/images are not
    // transmitted to this CDN. Can be self-hosted later without changing inference.
    ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";
    const bytes = await loadModel(data.modelUrl);
    let gpuAvailable = false;
    try { gpuAvailable = Boolean(await scope.navigator.gpu?.requestAdapter()); } catch { /* WASM fallback below */ }
    progress(gpuAvailable ? "Preparing your device's graphics processor…" : "Preparing field detection on this device…");
    try {
      session = await ort.InferenceSession.create(bytes, { executionProviders: [gpuAvailable ? "webgpu" : "wasm"], graphOptimizationLevel: "all" });
    } catch (error) {
      if (!gpuAvailable) throw error;
      progress("Using this device's CPU for field detection…");
      session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    }
    progress("Finding possible fields on this device…");
    input = new ort.Tensor("float32", data.pixels, [1, 3, 512, 512]);
    outputs = await session.run({ [session.inputNames[0]]: input });
    const heads = session.outputNames.map((name) => outputs![name]);
    if (heads.length !== 2 || heads.some((head) => head.type !== "float32")) throw new Error("The field detector returned an unsupported result.");
    progress("Preparing field boundaries for your review…");
    const polygons = decodeFieldPolygons(
      { data: heads[0].data as Float32Array, dims: heads[0].dims },
      { data: heads[1].data as Float32Array, dims: heads[1].dims }, data.transform,
    );
    scope.postMessage({ type: "result", polygons });
  } catch (error) {
    scope.postMessage({ type: "error", message: error instanceof Error ? error.message : "Field detection could not finish. You can draw the fields manually." });
  } finally {
    Object.values(outputs ?? {}).forEach((tensor) => tensor.dispose());
    input?.dispose();
    await session?.release();
  }
};
