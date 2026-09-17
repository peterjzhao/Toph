# SAM3 field onboarding: local feasibility experiment

Tested September 16, 2026 on an Apple M5 Pro, 48 GB unified memory. Conclusion:
**promising for assisted onboarding, insufficient for unattended parcel creation**.
The experiment runs on the Mac GPU with PyTorch/MPS; its HTML review displays saved
inference outputs. No browser inference, hosted GPU endpoint, database integration,
new farm creation or deployment was implemented or benchmarked.

## What was tested

Read SightSense in `/Users/peter/Downloads/LAVIII/SightSense`. Its structure pipeline
uses FastSAM and SAM3-LiteText, with precomputed `button`, `screen`, `knob`, `label`
embeddings. The exported Core ML model bundles and original AlphaG3n experiment
directory referenced by its README are missing on this machine. Its existing
embeddings cannot be relabeled as fields: a new concept requires new text features.

Downloaded `vil-uob/sam3-litetext-s0` at pinned revision
`b09766e54f5d2eba021119ec7feff13e74c0f8fc` (the checkpoint revision recorded by
SightSense's exporter). Ran the upstream model via Transformers 5.17.0 / PyTorch
2.14.0, FP16, on three real 1024 × 1024 USDA NAIP aerial images fetched through USGS.
These are not Toph's AI-generated illustrative farm maps. Five prompts per image
share a cached image encoding. No task-specific training was performed.

| Prompt | Salinas farm | Iowa farm | Iowa lake/residential control |
| --- | ---: | ---: | ---: |
| `field` | 61 | 18 | 11 |
| `agricultural field` | 39 | 17 | 2 |
| `crop field` | 0 | 0 | 0 |
| `farmland` | 29 | 18 | 0 |
| `building` (concept control) | 2 | 0 | 0 |

Numbers are **candidate masks** with score >= 0.5 and area >= 0.1% of the image;
they are not counts of verified fields. Raw masks may overlap or represent a whole
field and a subplot separately. The review retains candidates down to score 0.3.
`crop field` returned no candidates even at 0.3 on these samples; prompt sensitivity
is a real limitation, not an empty-state UI failure. The `building` prompt finding
two structures in Salinas provides a small concept-change sanity check, not a
building-detection benchmark.

Visual inspection: Salinas masks often follow roads, field boundaries and curved
edges while avoiding the beach, ocean and large water areas. Some masks merge
neighboring planted strips, include small holes, or overlap. Iowa farm masks follow
many rectangular fields and exclude some farmhouses but also produce overlapping
coarse/fine regions. The lake control leaves the large lake unmasked while proposing
some grassy patches with the broader `field` prompt. These are not necessarily
agricultural parcels. No hand-labeled ground truth exists for these samples, so
precision/recall, IoU, acreage accuracy and ownership are **not measured**.

## Measured runtime

Latest completed run, seconds, one process per image:

| Stage | Salinas | Iowa farm | Lake control |
| --- | ---: | ---: | ---: |
| Model/processor load | 2.277 | 2.255 | 2.413 |
| Image encoder | 0.598 | 0.556 | 0.536 |
| Text + decoder (`agricultural field`) | 0.103 | 0.092 | 0.091 |
| Postprocessing/output masks for that prompt | 0.580 | 0.268 | 0.101 |
| Encoding + prompt + postprocessing | 1.281 | 0.916 | 0.728 |

Model downloads (~2 GB) are excluded. The first cold Salinas invocation took
4.27 s to load, 2.39 s to encode and 2.76 s for its first prompt (`field`), before
runtime caches warmed. That invocation completed inference but initially lacked
the review template; it was subsequently rerun successfully end-to-end. These are
individual feasibility measurements, not latency percentiles or cloud/browser
performance guarantees. Additional prompts reuse the same image features. Model
scores are not percentages of correctness.

## Try it

The local review server currently uses port 8766, independently of Next.js:

- [Salinas farm](http://127.0.0.1:8766/salinas/)
- [Iowa farm](http://127.0.0.1:8766/iowa-farm/)
- [Lake/residential control](http://127.0.0.1:8766/iowa/)

Each page can switch prompts, filter by score, toggle overlays, select and name
candidates, and download GeoJSON. This is a review of saved inference, not a live
upload endpoint. Re-run the CLI to segment another image. [Setup and CLI](../../scripts/experiments/field-segmentation/README.md).
Local inputs, masks, previews and detailed `results.json` files are under ignored
`.local/field-segmentation/`. No existing app dependencies or files were changed.

Verification: three real inference runs (15 prompt/image pairs), a repeated Salinas
run with matching candidate counts, four geometry tests (holes/components, empty
masks, map projection/orientation, invalid CRS rejection), all 51 existing root unit
tests, and browser selection/naming/export/empty-state checks. Inspected the exported
GeoJSON to verify the chosen name and actual longitude/latitude coordinates.

## Runtime recommendation

Start with a **separate inference worker** and a thin authenticated Next.js API,
with image/job records scoped to the farm. A GPU worker can load the model once,
cache image features during review, and return candidate polygons and provenance.
This local experiment is evidence for the approach, not a verified deployment of
that architecture. Do not package these Python weights into a normal Next.js
serverless request handler or spawn Python per request in production. CPU/CUDA
paths are available in the script but untested here.

SAM3 supports concept prompts, which better matches this task than starting with
all of FastSAM's class-agnostic mask proposals. A prompt still cannot infer legal
parcels, ownership, invisible boundaries, or guarantee agricultural land. For a
fixed vocabulary, precompute the selected text embeddings (as SightSense does)
and cache them with the exact model revision. This optimization remains future work.

Browser inference is technically plausible, but is a separate experiment:
community SAM3 ONNX exports exist, and one INT8 browser export advertises ~889 MB
for image, text and detector weights. Its image encoder plus detector alone total
~501 MB, before runtime memory; precomputed text embeddings could eliminate the
text encoder download. LiteText reduces the text encoder, not the large vision
backbone. Core ML `.mlpackage` files cannot be directly loaded by WebGPU. Validate
operator support, peak memory, download/caching, precision parity and laptop/phone
latency before choosing browser-only onboarding. No ONNX browser benchmark or
export was attempted in this experiment.

## Proposed onboarding integration

1. Locate the farm and choose a bounded imagery area; obtain imagery with verified
   geographic bounds and provider permission. Large areas need tiling and overlap
   deduplication; image-edge masks need special handling.
2. Generate suggestions with one validated field prompt (compare `field`,
   `agricultural field`, `farmland` on representative farms first).
3. Let the farmer keep/remove, split/merge and edit boundaries, name fields, and
   draw missed ones. Require review for clipped edge candidates. The experiment
   includes selection/naming, but not geometry editing.
4. On explicit Save, validate polygons and persist farm-scoped fields and geometry
   in PostgreSQL with stable field UUIDs. Preserve imagery extent/date/provider,
   model revision, and user-confirmation provenance. Reuse these field IDs in logs.

Before production integration, evaluate representative farms, seasons, orchards,
pasture, bare soil and nonfarm controls with manual labels. Define acceptable
boundary error and review effort. Two farms do not establish general accuracy.

## Primary sources

- [Meta SAM3](https://github.com/facebookresearch/sam3): concept prompts, reference
  CUDA setup, checkpoint access and upstream license.
- [SAM3-LiteText checkpoint](https://huggingface.co/vil-uob/sam3-litetext-s0): lightweight
  text encoder with the original SAM3 vision encoder.
- [Transformers LiteText documentation](https://huggingface.co/docs/transformers/model_doc/sam3_lite_text).
- [Browser ONNX export author's model card](https://huggingface.co/rusen/sam3-browser-int8):
  file sizes and browser deployment claims; not independently benchmarked here.
- [USGS NAIP image service](https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer):
  imagery source; actual export requests/extents are saved with each sample.

Retain and review the upstream model and imagery licensing when packaging a
production deployment; a conversion model card's label does not replace upstream terms.

## Follow-up: FastSAM-s and FastSAM-x

At the user's request, tested both FastSAM variants on the exact same three input
files. Source SHA-256 matches were verified against the SAM3 reports. Used official
Ultralytics v8.4.0 release weights with Ultralytics 8.4.154, PyTorch/MPS FP32,
confidence floor 0.25, NMS IoU 0.9, retina masks, max 300 proposals and minimum
mask area 0.1%. No text filtering or container cleanup. The weights are 23.9 MB
(s) and 145.0 MB (x), and their hashes are stored in each result.

| Variant / input size | Salinas regions >= 0.5 | Iowa farm regions >= 0.5 | Lake control regions >= 0.5 | Salinas warm inference |
| --- | ---: | ---: | ---: | ---: |
| FastSAM-s / 1024 | 33 | 6 | 3 | 0.080 s |
| FastSAM-s / 1536 | 21 | 4 | 3 | 0.102 s |
| FastSAM-x / 1024 | 41 | 8 | 2 | 0.195 s |
| FastSAM-x / 1536 | 28 | 7 | 6 | 0.401 s |

These counts include nonfield regions and are not recall/precision metrics. The
same numerical score threshold is a convenient viewing setting, not a calibrated
quality comparison between FastSAM and SAM3. At the 0.25 confidence floor, after
the area filter, FastSAM-x/1024 retains 81 Salinas and 12 Iowa farm regions.

**Visual result:** FastSAM-x/1024 gives cleaner, smoother Salinas outlines with
fewer interior holes than SAM3-LiteText, but still misses fields, merges adjacent
plots and proposes buildings/other regions. FastSAM-s is lighter/faster, but has
more broad merged regions. Both variants miss several large Iowa fields. Raising
input size to 1536 did not recover those fields; it generally reduced field
coverage at the displayed threshold. This does not establish a universal preferred
resolution. Inspecting nonfarm control masks remains important because these models
do not classify farmland.

Warm timings include Ultralytics preprocessing, model inference and mask decoding;
polygon/PNG/overlay export is separate. FastSAM-x/1024 Salinas export took another
0.300 s (about 0.495 s combined); Iowa warm inference was 0.152 s plus 0.070 s
export. The first invocation before runtime caches warmed took 2.622 s for s and
0.737 s for x on Salinas. Latest model deserialization times were 0.01/0.06 s;
downloads and first-call initialization are excluded from warm timings.

Reviews: [FastSAM Salinas](http://127.0.0.1:8766/fastsam-salinas/),
[FastSAM Iowa farm](http://127.0.0.1:8766/fastsam-iowa-farm/),
[FastSAM lake control](http://127.0.0.1:8766/fastsam-iowa/).
Switch the dropdown between s/x and 1024/1536. These are actual saved model masks;
no manual boundary edits were applied. Inference remains local Python, not WebGPU.

Validation: 12 image/model/size combinations, each inferred twice; four geometry
tests pass; inspected output overlays and opened the FastSAM review in the browser.
The earlier root unit-test result remains the previous SAM3 experiment's result;
no app code changed in this follow-up. [Runner and commands](../../scripts/experiments/field-segmentation/README.md#fastsam-comparison).
[Official FastSAM usage and architecture](https://docs.ultralytics.com/models/fast-sam/).

## Follow-up: Delineate Anything v2

Checked the [authors' repository](https://github.com/Lavreniuk/Delineate-Anything)
and [official model files](https://huggingface.co/MykolaL/DelineateAnything/tree/main)
on September 16, 2026. V2 is the newest public checkpoint found; there is no newer
version in those sources. The checkpoint hub contains the original large model,
original small model, and v2 large model. The 17.6 MB small file is not v2.

Downloaded `DelineateAnythingv2.pt` at revision
`cff6ad11e3a0a7ccdcf1261fefb148309b5d6a8a`: 124,747,297 bytes, 62,051,411 parameters,
one `field` class, training input size 512. Tested 512 and 1024 inference on all
three unchanged images (input hashes verified), twice per setting. Ultralytics
8.4.154, PyTorch/MPS FP32, confidence floor 0.15, NMS IoU 0.7, retina masks,
minimum candidate area 0.1%. Weight SHA-256 and revision are saved in each report.

| Image | Input size | Candidates >= 0.15 | Candidates >= 0.5 | Warm inference | Polygon/file export |
| --- | ---: | ---: | ---: | ---: | ---: |
| Salinas | 512 | 100 | 46 | 0.100 s | 0.330 s |
| Salinas | 1024 | 104 | 45 | 0.316 s | 0.331 s |
| Iowa farm | 512 | 17 | 5 | 0.052 s | 0.060 s |
| Iowa farm | 1024 | 22 | 7 | 0.155 s | 0.075 s |
| Lake/residential control | 512 | 12 | 2 | 0.049 s | 0.035 s |
| Lake/residential control | 1024 | 27 | 4 | 0.160 s | 0.072 s |

Model deserialization took 0.10 s; first Salinas inference at 512 took 0.833 s.
These are individual local measurements, not production latency percentiles.
Counts remain proposals, not verified fields or calibrated accuracy measurements.

Visual inspection: v2 separates more narrow Salinas strips and produces fewer
jagged holes than SAM3-LiteText. It still splits some visually contiguous areas
and misses others. At 0.5 it misses several large Iowa fields; lowering the score
to the authors' example floor of 0.15 restores much of that coverage, with additional
overlapping coarse/fine regions. Critically, at 512/0.5 the lake/residential control
incorrectly identifies both large lake basins as fields. The raw model therefore
does not meet a field-only requirement; land-cover/water filtering must be tested.
A field-trained model does not eliminate review or the need for
representative labeled evaluation.

This test invokes the checkpoint directly through YOLO on raw RGB images. It does
**not** reproduce the complete authors' pipeline, which includes overlapping tiles,
normalization, mask morphology, polygon merging and optional land-cover filtering.
The upstream configuration and inference were inspected at code commit
`278a3d91e78535174e2a80865a67c77e855d3a91`. Native-size and 1024 tests are included;
the browser's default 0.5 is our comparison threshold, not the authors' default.

Reviews: [Salinas](http://127.0.0.1:8766/delany-v2-salinas/),
[Iowa farm](http://127.0.0.1:8766/delany-v2-iowa-farm/),
[lake control](http://127.0.0.1:8766/delany-v2-iowa/).
The inference runs locally in Python; the browser displays saved results.
[Reproduction instructions](../../scripts/experiments/field-segmentation/README.md#delineate-anything-v2).

Validation: six image/size combinations, each inferred twice; all input hashes
match the earlier SAM3 experiment; counts, closed/normalized polygon coordinates
and `field` class metadata checked; four geometry tests pass. No Toph app, database,
or deployment changes were made.
