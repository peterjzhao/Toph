# Browser field segmentation at 512px

Tested September 17, 2026. **Delineate Anything v2 can run on the farmer's device in
a browser.** Real ONNX Runtime Web inference succeeded on Chrome 152 with the Apple
Metal 3 WebGPU adapter on this M5 Pro/48 GB Mac. A single-thread WebAssembly CPU path
also completed. These are individual local measurements, not performance promises
for other computers, phones, Safari or Firefox. Peak total/GPU memory was not measured.

This follow-up supersedes the earlier server-worker recommendation in
[field-segmentation.md](field-segmentation.md) for the user's browser-only requirement.
That document's field-quality findings still apply: proposals may be missing,
overlapping or wrong; the lake control contains water mistaken for fields.

## Model and conversion

- Official checkpoint: `MykolaL/DelineateAnything`, `DelineateAnythingv2.pt`, pinned
  revision `cff6ad11e3a0a7ccdcf1261fefb148309b5d6a8a`; 124,747,297 bytes and 62,051,411 parameters.
- Fixed input: `[1,3,512,512]`, RGB float32, pixel values divided by 255. The app
  preserves image aspect ratio with centered RGB 114 padding and maps polygons
  back to normalized original-image coordinates. An ordinary uploaded image has
  no trusted geographic extent; no GPS coordinates or acreage are invented.
- Ultralytics 8.4.154 exporter, PyTorch 2.14.0, ONNX 1.22.0, ONNXslim 0.1.96, opset 17,
  static shape, no embedded NMS. Native/browser ONNX Runtime 1.30.0.
- Heads: detections `[1,37,5376]` and mask prototypes `[1,32,128,128]`. One field
  class, confidence floor 0.15, box NMS IoU 0.7. App postprocessing assembles masks,
  upsamples logits to 512px, thresholds at 0, removes regions smaller than 0.1% of
  unpadded image area, and traces/simplifies the largest exterior component.
- Merged proposals containing multiple smaller fields are removed before labeling.
  Polygon interiors are compared on a 256px grid: a parent must contain at least
  90% of each of two children, each child must be at least 20% smaller, and the
  children must overlap by no more than 25% of the smaller child's area. This
  preserves separate small fields without treating concave bounding-box gaps as
  containment. Saved, farmer-confirmed boundaries are not changed.
- The app contract supports simple polygon rings. Interior holes and smaller
  disconnected islands are not represented by this helper; admins must review
  boundaries before assigning field letters. This is the raw single-image model,
  not the authors' tiled GIS, land-cover and morphology pipeline.

| Artifact | Exact bytes | SHA-256 |
| --- | ---: | --- |
| FP32 ONNX, default | 248,344,427 | `381f3b4815c5fae895971121ded05a83733c9439dff4b28a56b590e334d85b37` |
| FP16 ONNX, experimental | 124,284,556 | `7082c7a7700ba42cc7f1e760eb3502a31c669d3fe7d5368ba6f504ea4a7e2186` |

The upstream repository supplies an ONNX export script. The official checkpoint
hub at the pinned revision contains PyTorch files, not a ready-made hosted ONNX
artifact. ONNX weights were generated here in ignored `.local/`; no model asset
was published and no external inference service was called.

## Measured browser results

All three public 1024×1024 USGS/NAIP source images match the earlier experiment's
hashes. Numerical comparisons use identical, preprocessed input tensors. Each
image/runtime/precision combination ran twice; warm below means the second run.

| Runtime | Salinas warm | Iowa farm warm | Lake control warm | Mask counts at 0.15 |
| --- | ---: | ---: | ---: | --- |
| WebGPU FP32 | 86.1 ms | 80.1 ms | 87.4 ms | 100 / 17 / 12 |
| WebGPU FP16 | 58.3 ms | 58.2 ms | 58.5 ms | 100 / 18 / 12 |
| WASM CPU FP32, one thread | 3426.5 ms | 3347.3 ms | 3346.5 ms | 100 / 17 / 12 |

These counts include non-fields. First Salinas inference was 536.8 ms for WebGPU
FP32 and 433.6 ms for FP16. Session creation was 472.7 ms / 136.5 ms respectively;
JavaScript mask decoding took 0.6–20.6 ms. Static localhost model transfer took about
0.2–0.3 seconds, which does **not** measure internet download time. Browser runtime
support files require an additional download; the observed 1.30.0 WebGPU path used
the approximately 26 MB asyncify WASM binary.

FP32 WebGPU matched PyTorch with maximum raw detection-head difference 0.00384
(the head includes pixel-valued box coordinates), mean about 0.000004, and maximum
mask-prototype difference about 0.000020. WASM FP32 was similarly close. FP16 ran
successfully but changed some scores and one Iowa candidate; raw detection
differences reached 37.7 on some entries. No mask-IoU accuracy evaluation was done
for FP16, so **the app uses FP32**. The smaller artifact remains experimental.

Separately, the actual app helper/worker processed the Salinas image with browser
canvas preprocessing in 1007 ms end-to-end after a local transfer, produced 98
normalized polygons and allowed 10 UI heartbeat updates during that second. The
count differs from the exact-tensor test because browser preprocessing differs.
Cancellation terminated the worker with `AbortError`; retry then completed. An
overlay was visually inspected. Root onboarding integration additionally exercised
the same helper in Next.js, selection, and saving; those checks belong to the
parent implementation's validation record.

Six geometry tests pass. All 129 polygons decoded from the three real cached
PyTorch heads pass the actual server's boundary validator, with a maximum of 152
vertices. This verifies coordinate/topology compatibility, not correctness against
ground-truth field boundaries.

## App interface and deployment assets

```ts
import { detectFields, supportsFieldDetection } from "@/lib/segmentation/detect-fields";

const candidates = await detectFields(imageElement, {
  onProgress: setProgress,
  signal: abortController.signal,
  // Optional override; must be a public, CORS-enabled FP32 artifact URL.
  modelUrl: "/models/delineate-v2-512-fp32.onnx",
});
```

Returns `Array<Array<{x:number,y:number}>>`, normalized 0–1 with top-left origin.
Rings are open arrays, with their closing edge implicit, capped at 200 vertices.
The helper returns candidates for review; it does not silently keep only 26.
The UI permits at most 26 accepted fields labeled A–Z and saves only on confirmation.

Inference and polygon extraction run in a dedicated Web Worker. WebGPU is tried
when an adapter exists; unavailable/failed initialization falls back to single-thread
WASM. Cancel terminates the worker, including its download/computation. Failures
surface to the UI so manual outlining remains available. No server inference
fallback exists. Accepted farm images and polygons are subsequently saved by the
normal farm API when the admin confirms; "browser inference" does not mean the
confirmed farm map is never stored.

The model is downloaded only when detection is requested and cached locally when
Cache Storage is available. The default is `/models/delineate-v2-512-fp32.onnx`;
`NEXT_PUBLIC_FIELD_MODEL_URL` (build-time public config) or `modelUrl` overrides it.
The helper fetches pinned ONNX Runtime 1.30.0 support assets from jsDelivr. Those
requests carry no image pixels; applications with stricter CSP/offline requirements
can self-host the version-matched files and change `wasmPaths`.

Local setup:

```sh
mkdir -p public/models
cp .local/browser-segmentation/site/models/delineate-v2-512-fp32.onnx public/models/delineate-v2-512-fp32.onnx
```

`public/models/*.onnx` must remain ignored. A Git push alone will not make the model
available on the hosted site. Publish the generated model as a separate public
static artifact with correct CORS/cache headers, then configure its URL. Avoid
function requests for model delivery and retain a stable versioned URL. The setup screen requires a successful detection before fields can be assigned;
manual rectangle and outline controls have been removed. No app deployment
or model publication was performed in this experiment.

The [official repository license](https://github.com/Lavreniuk/Delineate-Anything/blob/278a3d91e78535174e2a80865a67c77e855d3a91/LICENSE)
and [checkpoint model card](https://huggingface.co/MykolaL/DelineateAnything) identify
AGPL-3.0. Preserve the model's attribution, license and source/export recipe when
distributing it; do not relabel it as the app's own model. ONNX Runtime is MIT.

## Reproduce and primary references

[Runner, exact dependencies and checks](../../scripts/experiments/browser-segmentation/README.md).

- [Authors' fixed 512px ONNX export implementation](https://github.com/Lavreniuk/Delineate-Anything/blob/278a3d91e78535174e2a80865a67c77e855d3a91/export_onnx.py).
- [ONNX Runtime WebGPU setup](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html).
- [ONNX Runtime web deployment and runtime files](https://onnxruntime.ai/docs/tutorials/web/deploy.html).
- [Model size, browser limits and caching](https://onnxruntime.ai/docs/tutorials/web/large-models.html).

Before enabling browser detection broadly, test lower-memory devices and browser
families, real network/cache behavior, representative farm imagery and accepted
field boundary quality. These tests establish feasibility on one device, not
universal support or parcel accuracy.
