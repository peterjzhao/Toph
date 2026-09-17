#!/usr/bin/env python3
"""Local SAM3-LiteText feasibility test; never writes farm records.

Outputs masks, normalized polygon candidates, an overlay, and a browser review.
Model scores are ranking signals, not measured boundary accuracy.
"""
import argparse
import hashlib
import json
import math
import platform
import time
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image, ImageDraw, ImageOps
from transformers import AutoModel, AutoProcessor

MODEL = "vil-uob/sam3-litetext-s0"
REVISION = "b09766e54f5d2eba021119ec7feff13e74c0f8fc"
PALETTE = ["#a3e635", "#38bdf8", "#fbbf24", "#fb7185", "#c084fc", "#2dd4bf"]


def polygons_from_mask(mask):
    """Keep disconnected components and holes; coordinates are image fractions."""
    height, width = mask.shape
    contours, hierarchy = cv2.findContours(mask.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is None:
        return []
    hierarchy = hierarchy[0]

    def ring(contour):
        vertices = cv2.approxPolyDP(contour, 1.5, True).reshape(-1, 2)
        if len(vertices) < 3:
            return None
        points = [[round(float(x) / width, 7), round(float(y) / height, 7)] for x, y in vertices]
        return points + [points[0]]

    polygons = []
    for index, contour in enumerate(contours):
        if hierarchy[index][3] != -1:
            continue
        outer = ring(contour)
        if outer is None:
            continue
        rings = [outer]
        child = hierarchy[index][2]
        while child != -1:
            hole = ring(contours[child])
            if hole is not None:
                rings.append(hole)
            child = hierarchy[child][0]
        polygons.append(rings)
    return polygons


def wgs84_polygons(polygons, extent):
    if extent.get("spatialReference", {}).get("latestWkid", extent.get("spatialReference", {}).get("wkid")) not in (3857, 102100):
        raise ValueError("Georeferencing requires the actual exported EPSG:3857 image extent")
    def project(point):
        x = extent["xmin"] + point[0] * (extent["xmax"] - extent["xmin"])
        y = extent["ymax"] - point[1] * (extent["ymax"] - extent["ymin"])
        return [x / 6378137 * 180 / math.pi, (2 * math.atan(math.exp(y / 6378137)) - math.pi / 2) * 180 / math.pi]
    return [[[project(p) for p in ring] for ring in polygon] for polygon in polygons]


def sync(device):
    if device == "mps":
        torch.mps.synchronize()
    elif device == "cuda":
        torch.cuda.synchronize()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--prompts", nargs="+", default=["field", "agricultural field", "crop field", "farmland"])
    parser.add_argument("--threshold", type=float, default=0.3, help="Keep candidates down to this score; review defaults to 0.5")
    parser.add_argument("--min-area", type=float, default=0.001, help="Minimum fraction of image area")
    parser.add_argument("--source", type=Path, help="Optional JSON: attribution, export request, and actual image extent")
    parser.add_argument("--device", choices=["mps", "cpu", "cuda"], default="mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu")
    args = parser.parse_args()
    if not 0 <= args.threshold <= 1 or not 0 <= args.min_area <= 1:
        parser.error("Threshold and minimum area must be in [0, 1]")
    args.output.mkdir(parents=True, exist_ok=True)
    image = ImageOps.exif_transpose(Image.open(args.image)).convert("RGB")
    image.thumbnail((1600, 1600))
    image.save(args.output / "source.jpg", quality=95)
    source = json.loads(args.source.read_text()) if args.source else {"description": "User-supplied image; no geographic coordinates"}
    print(f"Loading {MODEL} on {args.device}", flush=True)
    started = time.perf_counter()
    dtype = torch.float32 if args.device == "cpu" else torch.float16
    model = AutoModel.from_pretrained(MODEL, revision=REVISION, dtype=dtype).to(args.device).eval()
    processor = AutoProcessor.from_pretrained(MODEL, revision=REVISION)
    sync(args.device)
    load_seconds = time.perf_counter() - started
    inputs = processor(images=image, return_tensors="pt").to(args.device)
    started = time.perf_counter()
    with torch.inference_mode():
        vision = model.get_vision_features(inputs.pixel_values.to(dtype))
    sync(args.device)
    encoder_seconds = time.perf_counter() - started
    print(f"Model load {load_seconds:.2f}s; image encoder {encoder_seconds:.2f}s", flush=True)
    report = {
        "model": MODEL, "revision": REVISION, "device": args.device, "dtype": str(dtype),
        "hardware": platform.platform(), "torch": torch.__version__,
        "source": source, "sourceSha256": hashlib.sha256(args.image.read_bytes()).hexdigest(),
        "width": image.width, "height": image.height, "coordinateSystem": "normalized image xy, origin top-left; NOT GPS",
        "loadSeconds": load_seconds, "encoderSeconds": encoder_seconds,
        "threshold": args.threshold, "minAreaFraction": args.min_area,
        "requiresHumanReview": True, "measuredAccuracy": None, "runs": [],
    }
    for run_index, prompt in enumerate(args.prompts):
        started = time.perf_counter()
        text = processor(text=prompt, return_tensors="pt").to(args.device)
        with torch.inference_mode():
            outputs = model(vision_embeds=vision, **text)
        sync(args.device)
        decoder_seconds = time.perf_counter() - started
        # CPU postprocessing bounds GPU memory; raw score includes presence probability.
        for key in ("pred_masks", "pred_boxes", "pred_logits", "presence_logits"):
            value = getattr(outputs, key, None)
            if value is not None:
                setattr(outputs, key, value.float().cpu())
        result = processor.post_process_instance_segmentation(outputs, threshold=args.threshold, mask_threshold=0.5, target_sizes=[image.size[::-1]])[0]
        candidates = []
        overlay = np.array(image).copy()
        mask_dir = args.output / f"masks-{run_index}"
        mask_dir.mkdir(exist_ok=True)
        for query in result["scores"].argsort(descending=True).tolist():
            mask = result["masks"][query].numpy().astype(bool)
            area = float(mask.mean())
            if area < args.min_area:
                continue
            polygons = polygons_from_mask(mask)
            if not polygons:
                continue
            index = len(candidates)
            mask_name = f"masks-{run_index}/{index + 1}.png"
            Image.fromarray(mask.astype(np.uint8) * 255).save(args.output / mask_name)
            candidate = {"id": f"p{run_index}-{index + 1}", "score": float(result["scores"][query]), "areaFraction": area,
                         "polygons": polygons, "mask": mask_name, "touchesImageEdge": bool(mask[0].any() or mask[-1].any() or mask[:, 0].any() or mask[:, -1].any())}
            if "extent" in source:
                candidate["geojson"] = {"type": "Feature", "properties": {"prompt": prompt, "score": candidate["score"], "requiresHumanReview": True}, "geometry": {"type": "MultiPolygon", "coordinates": wgs84_polygons(polygons, source["extent"])}}
            candidates.append(candidate)
            if candidate["score"] >= 0.5:
                color = tuple(bytes.fromhex(PALETTE[index % len(PALETTE)][1:]))
                overlay[mask] = (overlay[mask] * 0.62 + np.array(color) * 0.38).astype(np.uint8)
                contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
                cv2.drawContours(overlay, contours, -1, color, 2)
        post_seconds = time.perf_counter() - started - decoder_seconds
        overlay_image = Image.fromarray(overlay)
        draw = ImageDraw.Draw(overlay_image)
        draw.rectangle((0, 0, image.width, 30), fill="#152923")
        count = sum(c["score"] >= 0.5 for c in candidates)
        draw.text((10, 9), f'SAM3-LiteText / "{prompt}" / {count} candidates at score >= 0.5 / review required', fill="white")
        overlay_image.save(args.output / f"overlay-{run_index}.jpg", quality=94)
        run = {"prompt": prompt, "decoderSeconds": decoder_seconds, "postprocessSeconds": post_seconds,
               "countAtHalf": count, "candidates": candidates, "overlay": f"overlay-{run_index}.jpg"}
        report["runs"].append(run)
        print(f'{prompt!r}: {len(candidates)} candidates, {count} at >=0.5; prompt/decode {decoder_seconds:.2f}s; post {post_seconds:.2f}s', flush=True)
        (args.output / "results.json").write_text(json.dumps(report, indent=2))
    template = Path(__file__).with_name("review.html").read_text()
    (args.output / "index.html").write_text(template.replace("/*REPORT*/null", json.dumps(report).replace("<", "\\u003c")))
    print(f'Review: {args.output / "index.html"}', flush=True)


if __name__ == "__main__":
    main()
