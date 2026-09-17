# Field segmentation experiment

Runs real SAM3-LiteText inference locally, then builds an interactive browser review
of the saved results. The review page does **not** run the model in the browser and
does not write Toph farm records. Nothing is deployed.

From the repository root:

```sh
uv venv --python 3.12 .local/field-segmentation/.venv
uv pip install --python .local/field-segmentation/.venv/bin/python -r scripts/experiments/field-segmentation/requirements.txt
.local/field-segmentation/.venv/bin/python scripts/experiments/field-segmentation/fetch_samples.py
.local/field-segmentation/.venv/bin/python scripts/experiments/field-segmentation/run.py \
  --image .local/field-segmentation/samples/salinas.jpg \
  --source .local/field-segmentation/samples/salinas-source.json \
  --output .local/field-segmentation/salinas \
  --prompts field 'agricultural field' 'crop field' farmland building
.local/field-segmentation/.venv/bin/python -m http.server 8766 --bind 127.0.0.1 --directory .local/field-segmentation
```

Open <http://127.0.0.1:8766/salinas/>. Repeat the inference command with `iowa-farm`
for agricultural imagery and `iowa` for the lake/residential negative control.
The latter is intentionally **not a farm**. Sample imagery comes from USDA NAIP
through USGS The National Map; acquisition dates are not verified. There are no
parcel ground-truth labels. Downloads are saved alongside the exact export request
and returned map extent. Model weights (~2 GB) are cached by Hugging Face outside
the repository. The pinned revision is the same checkpoint identified by
SightSense's concept exporter, but this experiment uses upstream PyTorch weights,
not SightSense's reduced-resolution Core ML exports.

To test your own image, supply `--image /absolute/path/to/image.jpg` and a fresh
`--output` directory. Omit `--source` for non-georeferenced photos/screenshots.
`--device cpu`, `--device mps`, and `--device cuda` select the runtime; only MPS has
been exercised here. Images are EXIF-oriented and capped at 1600 px on the long
side; the processor uses the model's configured encoder resolution. This cap is
for the experiment, not a large-farm tiling strategy.

Outputs:

- `results.json`: model/revision, input hash, timing, prompt scores and candidates.
- `source.jpg`, `overlay-*.jpg`, `masks-*/*.png`: input preview and actual masks.
- `index.html`: prompt/threshold comparison, select/name fields, export candidates.

Threshold changes filter cached results; they do not rerun inference. Candidate
IDs identify a suggestion within this run, **not persisted farm/field IDs**. Export
includes only selected candidates visible under the current prompt and threshold.
Selections and names last for the current page session. Outputs deliberately keep
overlaps, disconnected components and holes visible for inspection. There is no
cross-prompt merging, NMS, hole filling or manual boundary editor yet.

Coordinates in `polygons` are normalized image `[x,y]`, with a top-left origin.
With a USGS `--source`, GeoJSON uses the **returned EPSG:3857 extent**, converted to
WGS84 longitude/latitude (image y is inverted). Without that extent the export is
image-coordinate JSON, never invented GPS. Closed rings retain holes and separate
components. Contours are simplified at 1.5 output-image pixels; raw PNG masks are
kept. Tiny components that cannot form a polygon are omitted. Polygons need further
validity/overlap checks before any production persistence.

Checks:

```sh
.local/field-segmentation/.venv/bin/python scripts/experiments/field-segmentation/test_geometry.py
npm run test:unit
```

See [the experiment findings](../../../docs/backend/field-segmentation.md) for results,
limitations, backend integration recommendations, and browser inference feasibility.

## FastSAM comparison

The follow-up uses the same images with FastSAM-s (the SightSense variant) and
FastSAM-x at 1024 and 1536 encoder input sizes. These are unclassified region
proposals, not text-prompted field predictions. Both models use FP32, confidence
floor 0.25, box NMS IoU 0.9, retina masks, and the same minimum area of 0.1%.
The viewer starts at score 0.5. Scores are not calibrated between models.

```sh
uv pip install --python .local/field-segmentation/.venv/bin/python -r scripts/experiments/field-segmentation/requirements-fastsam.txt
mkdir -p .local/field-segmentation/weights
curl -fL https://github.com/ultralytics/assets/releases/download/v8.4.0/FastSAM-s.pt -o .local/field-segmentation/weights/FastSAM-s.pt
curl -fL https://github.com/ultralytics/assets/releases/download/v8.4.0/FastSAM-x.pt -o .local/field-segmentation/weights/FastSAM-x.pt
.local/field-segmentation/.venv/bin/python scripts/experiments/field-segmentation/run_fastsam.py --sizes 1024 1536
```

Open <http://127.0.0.1:8766/fastsam-salinas/> or
<http://127.0.0.1:8766/fastsam-iowa-farm/> using the same local review server.
Use the dropdown to compare the four model/size combinations. Reports preserve
weight SHA-256 hashes, first-call and warm timings, raw proposal counts and model
settings. There is no CLIP text filtering, learned farmland classifier, or
SightSense-specific container-removal heuristic. This is a PyTorch/MPS comparison,
not a parity check against SightSense's Core ML decoder.

## Delineate Anything v2

Uses the same environment and reusable YOLO report runner as FastSAM. Download the
author's v2 checkpoint at the pinned revision, then run:

```sh
.local/field-segmentation/.venv/bin/python -c "from huggingface_hub import hf_hub_download; hf_hub_download('MykolaL/DelineateAnything', 'DelineateAnythingv2.pt', revision='cff6ad11e3a0a7ccdcf1261fefb148309b5d6a8a', local_dir='.local/field-segmentation/weights/delany-v2')"
.local/field-segmentation/.venv/bin/python scripts/experiments/field-segmentation/run_delineate.py
```

Reviews: <http://127.0.0.1:8766/delany-v2-salinas/>,
<http://127.0.0.1:8766/delany-v2-iowa-farm/>, and
<http://127.0.0.1:8766/delany-v2-iowa/>.

The checkpoint's class is `field`; trained input size is 512 and there are
62,051,411 parameters. Test both 512 and 1024 on the original RGB images. Inference
uses confidence floor 0.15 (the author's example), box NMS IoU 0.7, FP32/MPS, retina
masks, and the same 0.1% area filter as our other comparisons. The viewer starts
at 0.5 for consistency; lower it to 0.15 to inspect all saved candidates.

This is a **model-only comparison**, not a run of the authors' full geospatial
pipeline. No tiled inference, percentile stretch, mask morphology, land-cover
filtering, GIS merging, or manual edits are applied. Upstream settings were inspected
at code commit `278a3d91e78535174e2a80865a67c77e855d3a91`. The older small 17.6 MB
checkpoint is v1, not a small v2; it was not substituted or tested here.
