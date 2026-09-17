#!/usr/bin/env python3
"""Compare FastSAM-s/x on the same saved aerial images as SAM3-LiteText."""
import argparse
import hashlib
import json
import os
import platform
import time
from pathlib import Path

os.environ.setdefault("YOLO_CONFIG_DIR", str(Path(".local/field-segmentation/ultralytics").resolve()))
os.environ.setdefault("YOLO_AUTOINSTALL", "false")
Path(os.environ["YOLO_CONFIG_DIR"]).mkdir(parents=True, exist_ok=True)

import cv2
import numpy as np
import torch
import ultralytics
from PIL import Image, ImageDraw, ImageOps
from ultralytics import FastSAM

from run import PALETTE, polygons_from_mask, sync, wgs84_polygons


def main(profile=None):
    profile = profile or {}
    family = profile.get("family", "FastSAM")
    variants = profile.get("variants", ["s", "x"])
    confidence = profile.get("confidence", 0.25)
    nms_iou = profile.get("nmsIoU", 0.9)
    prefix = profile.get("prefix", "fastsam")
    model_factory = profile.get("factory", FastSAM)
    parser = argparse.ArgumentParser(description=profile.get("description", __doc__))
    parser.add_argument("--root", type=Path, default=Path(".local/field-segmentation"))
    parser.add_argument("--samples", nargs="+", default=["salinas", "iowa-farm", "iowa"])
    parser.add_argument("--models", nargs="+", choices=variants, default=variants)
    parser.add_argument("--sizes", nargs="+", type=int, default=profile.get("sizes", [1024]))
    parser.add_argument("--device", choices=["mps", "cpu", "cuda"], default="mps" if torch.backends.mps.is_available() else "cpu")
    args = parser.parse_args()
    reports = {}
    for sample in args.samples:
        image_path = args.root / "samples" / f"{sample}.jpg"
        image = ImageOps.exif_transpose(Image.open(image_path)).convert("RGB")
        source = json.loads((args.root / "samples" / f"{sample}-source.json").read_text())
        output = args.root / f"{prefix}-{sample}"
        output.mkdir(parents=True, exist_ok=True)
        image.save(output / "source.jpg", quality=95)
        reports[sample] = {"model": " / ".join(f"{family}-{m}" for m in args.models), "device": args.device,
            "dtype": "torch.float32", "hardware": platform.platform(), "torch": torch.__version__,
            "ultralytics": ultralytics.__version__, "source": source,
            "sourceSha256": hashlib.sha256(image_path.read_bytes()).hexdigest(),
            "width": image.width, "height": image.height, "coordinateSystem": "normalized image xy, origin top-left; NOT GPS",
            "loadSeconds": 0, "encoderSeconds": 0, "threshold": confidence, "minAreaFraction": 0.001,
            "nmsIoU": nms_iou, "retinaMasks": True, "requiresHumanReview": True, "measuredAccuracy": None,
            "checkpointRevision": profile.get("revision"), "pipelineNotes": profile.get("notes"), "runs": []}
    for variant in args.models:
        label = f"{family}-{variant}"
        weights = args.root / "weights" / profile.get("weights", f"FastSAM-{variant}.pt")
        if not weights.is_file():
            raise FileNotFoundError(f"Download official Ultralytics weights first: {weights}")
        started = time.perf_counter()
        model = model_factory(str(weights))
        load_seconds = time.perf_counter() - started
        weights_hash = hashlib.sha256(weights.read_bytes()).hexdigest()
        print(f"Loaded {label}: {weights.stat().st_size / 1e6:.1f} MB in {load_seconds:.2f}s", flush=True)
        for sample in args.samples:
            report = reports[sample]
            report["loadSeconds"] += load_seconds
            image = Image.open(args.root / "samples" / f"{sample}.jpg").convert("RGB")
            output = args.root / f"{prefix}-{sample}"
            for size in args.sizes:
                # Keep first-call timing separate from a warm repeat on the identical input.
                timings = []
                for _ in range(2):
                    started = time.perf_counter()
                    result = model.predict(image, device=args.device, imgsz=size, conf=confidence, iou=nms_iou,
                                           retina_masks=True, quantize=32, max_det=300, verbose=False, save=False)[0]
                    sync(args.device)
                    timings.append(time.perf_counter() - started)
                started = time.perf_counter()
                candidates = []
                run_index = len(report["runs"])
                mask_dir = output / f"masks-{run_index}"
                mask_dir.mkdir(exist_ok=True)
                overlay = np.array(image).copy()
                scores = result.boxes.conf.detach().cpu().numpy()
                masks = result.masks.data.detach().cpu().numpy() if result.masks is not None else []
                for query in np.argsort(-scores):
                    mask = masks[query] > 0.5
                    if mask.shape != (image.height, image.width):
                        raise ValueError("retina_masks did not preserve the input dimensions")
                    area = float(mask.mean())
                    if area < report["minAreaFraction"]:
                        continue
                    polygons = polygons_from_mask(mask)
                    if not polygons:
                        continue
                    index = len(candidates)
                    name = f"masks-{run_index}/{index + 1}.png"
                    Image.fromarray(mask.astype(np.uint8) * 255).save(output / name)
                    candidate = {"id": f"{prefix}-{variant}-{size}-{index + 1}", "score": float(scores[query]),
                        "areaFraction": area, "polygons": polygons, "mask": name,
                        "touchesImageEdge": bool(mask[0].any() or mask[-1].any() or mask[:, 0].any() or mask[:, -1].any())}
                    candidate["geojson"] = {"type": "Feature", "properties": {"model": label,
                        "score": candidate["score"], "requiresHumanReview": True, "semanticClass": profile.get("semanticClass")},
                        "geometry": {"type": "MultiPolygon", "coordinates": wgs84_polygons(polygons, report["source"]["extent"])}}
                    candidates.append(candidate)
                    if candidate["score"] >= 0.5:
                        color = tuple(bytes.fromhex(PALETTE[index % len(PALETTE)][1:]))
                        overlay[mask] = (overlay[mask] * 0.62 + np.array(color) * 0.38).astype(np.uint8)
                        contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
                        cv2.drawContours(overlay, contours, -1, color, 2)
                count = sum(c["score"] >= 0.5 for c in candidates)
                preview = Image.fromarray(overlay)
                draw = ImageDraw.Draw(preview)
                draw.rectangle((0, 0, image.width, 30), fill="#152923")
                draw.text((10, 9), f"{label} / {size}px / {count} regions at score >= 0.5 / {profile.get('semanticClass', 'class-agnostic')}", fill="white")
                preview.save(output / f"overlay-{run_index}.jpg", quality=94)
                post_seconds = time.perf_counter() - started
                run = {"prompt": f"{label} · {size}px", "weightsSha256": weights_hash,
                    "weightsBytes": weights.stat().st_size, "imageSize": size, "firstCallSeconds": timings[0],
                    "decoderSeconds": timings[1], "postprocessSeconds": post_seconds,
                    "ultralyticsSpeedMs": result.speed, "rawMaskCount": len(scores), "countAtHalf": count,
                    "candidates": candidates, "overlay": f"overlay-{run_index}.jpg"}
                report["runs"].append(run)
                print(f"{sample} / {label} / {size}: {len(scores)} raw masks; {len(candidates)} area-filtered; {count} at 0.5; first {timings[0]:.3f}s; warm {timings[1]:.3f}s; export {post_seconds:.3f}s", flush=True)
                (output / "results.json").write_text(json.dumps(report, indent=2))
    template = Path(__file__).with_name("review.html").read_text()
    # Reuse the review interactions, while explicitly replacing SAM3-specific copy.
    template = template.replace("SAM3-LiteText proposes boundaries from aerial imagery.", profile.get("intro", "FastSAM proposes image regions without identifying which ones are farmland."))
    template = template.replace("Review field suggestions", "Review region proposals")
    template = template.replace("Text prompt", "Model / input resolution").replace("encode + prompt", "warm inference")
    template = template.replace("Initial model load:", "Combined model load:")
    template = template.replace("Image encoding: ${report.encoderSeconds.toFixed(1)}s, reused across prompts.", "The displayed inference time is a warm repeat, including model preprocessing and mask decoding. Polygon/file export time is separate. " + profile.get("uiNotes", "These masks carry no field classification."))
    template = template.replace("r.prompt==='agricultural field'", "r.prompt==='" + profile.get("preferred", "FastSAM-x · 1024px") + "'")
    for sample, report in reports.items():
        output = args.root / f"{prefix}-{sample}"
        (output / "index.html").write_text(template.replace("/*REPORT*/null", json.dumps(report).replace("<", "\\u003c")))
        print(f"Review: {output / 'index.html'}", flush=True)


if __name__ == "__main__":
    main()
