# Delineate Anything v2 in the browser

This is actual browser inference, not a viewer for precomputed masks. A static
localhost server serves the exported model and public sample images. No image is
sent to an inference service. See [measured findings](../../../docs/backend/browser-segmentation.md).

The checkpoint and unchanged public USGS samples come from the earlier
[field-segmentation experiment](../field-segmentation/README.md). Run its download
steps first if `.local/field-segmentation/weights/delany-v2/` and `samples/` do not
exist. The checkpoint must be the v2 file at revision
`cff6ad11e3a0a7ccdcf1261fefb148309b5d6a8a`, not the older small model.

From the repository root:

```sh
uv venv --python 3.12 .local/browser-segmentation/.venv
uv pip install --python .local/browser-segmentation/.venv/bin/python -r scripts/experiments/browser-segmentation/requirements.txt
.local/browser-segmentation/.venv/bin/python scripts/experiments/browser-segmentation/prepare.py
mkdir -p .local/browser-segmentation/site/ort
cp node_modules/onnxruntime-web/dist/ort.webgpu.min.js node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.* .local/browser-segmentation/site/ort/
.local/browser-segmentation/.venv/bin/python scripts/experiments/browser-segmentation/serve.py
```

Open <http://127.0.0.1:8768/>. Choose WebGPU/FP32 and run all three samples; repeat
with WebGPU/FP16 and WASM/FP32. The 1.30.0 browser runtime is installed by root
`npm ci`. All generated weights, images, tensors and reports stay under ignored
`.local/browser-segmentation/`; nothing from that directory should be committed.

`prepare.py` exports static ONNX opset 17 with float32 RGB NCHW input
`[1,3,512,512]` scaled to 0–1. Its numerical parity tests use the exact same OpenCV
resized tensor for PyTorch, native ONNX and browser ONNX. The image upload control
instead uses real browser canvas resizing and letterboxing; this preprocessing is
not claimed pixel-identical to OpenCV. The comparison viewer decodes masks at the
128px prototype resolution; the app's decoder upsamples to 512px before tracing
polygons. Candidate counts are not field accuracy scores.

## Test the app helper independently

This uses the real source modules with a small standalone esbuild bundle. It is
useful for exercising cancellation, caching, runtime/CDN loading and responsiveness
without creating an account. The actual Next.js onboarding flow still needs its
own integration check.

```sh
node_modules/.bin/esbuild src/lib/segmentation/detect-fields.ts --bundle --format=esm --platform=browser --define:process.env.NEXT_PUBLIC_FIELD_MODEL_URL=undefined --outfile=.local/browser-segmentation/site/detect-fields.js
node_modules/.bin/esbuild src/lib/segmentation/segmentation.worker.ts --bundle --format=esm --platform=browser --outfile=.local/browser-segmentation/site/segmentation.worker.ts
cp scripts/experiments/browser-segmentation/worker-test.html .local/browser-segmentation/site/worker-test.html
```

Open <http://127.0.0.1:8768/worker-test.html>. The static test server serves the
bundled worker's `.ts` basename as JavaScript so the helper's URL remains unchanged.
The helper fetches pinned ONNX Runtime support files from jsDelivr; that request
contains no uploaded image. Model weights are served from this local test site.

```sh
node --import tsx --test scripts/experiments/browser-segmentation/decoder.test.ts
node --conditions=react-server --import tsx scripts/experiments/browser-segmentation/validate-fixtures.ts
```

The first command checks geometry/normalization/NMS edge cases. The second decodes
actual cached network outputs and checks every resulting polygon with the app's
server validator. It requires `prepare.py` outputs and never accesses PostgreSQL.

For local onboarding, copy the FP32 ONNX file into ignored `public/models/` as
documented in the findings. Rebuild the helper bundle after editing its source.
