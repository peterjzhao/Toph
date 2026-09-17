#!/usr/bin/env python3
"""Export a pinned 512px Delineate Anything v2 graph and browser parity fixtures.

All generated weights/results stay in the ignored .local directory. This is a
model-only feasibility experiment, not the upstream tiled geospatial pipeline.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import shutil
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
os.environ.setdefault("YOLO_CONFIG_DIR", str(ROOT / ".local/browser-segmentation/ultralytics"))
os.environ.setdefault("YOLO_AUTOINSTALL", "false")

import cv2
import numpy as np
import onnx
import onnxruntime as ort
import onnxslim
import torch
from onnxruntime.transformers.float16 import convert_float_to_float16
from ultralytics import YOLO

REVISION = "cff6ad11e3a0a7ccdcf1261fefb148309b5d6a8a"
CHECKPOINT_SHA256 = "46700b8a279b07922953a11adaeb5e658d9a2384b6334c8e0a3090886218915a"


def digest(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weights", type=Path, default=ROOT / ".local/field-segmentation/weights/delany-v2/DelineateAnythingv2.pt")
    parser.add_argument("--samples", type=Path, default=ROOT / ".local/field-segmentation/samples")
    parser.add_argument("--output", type=Path, default=ROOT / ".local/browser-segmentation/site")
    args = parser.parse_args()
    if digest(args.weights) != CHECKPOINT_SHA256:
        raise ValueError("Supplied checkpoint does not match the pinned Delineate Anything v2 revision")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    model_dir = output / "models"
    model_dir.mkdir(exist_ok=True)
    checkpoint = model_dir / "DelineateAnythingv2.pt"
    if not checkpoint.exists():
        shutil.copy2(args.weights, checkpoint)
    if digest(checkpoint) != digest(args.weights):
        raise ValueError("Existing checkpoint differs from supplied weights")
    report = {
        "model": "Delineate Anything v2", "revision": REVISION,
        "checkpointBytes": checkpoint.stat().st_size, "checkpointSha256": digest(checkpoint),
        "input": {"shape": [1, 3, 512, 512], "type": "float32", "color": "RGB", "range": [0, 1]},
        "versions": {name: importlib.metadata.version(name) for name in ["torch", "ultralytics", "onnx", "onnxruntime", "onnxslim"]},
        "models": {}, "samples": [],
        "scope": "Fixed 512 single-image raw model. No tiling, land-cover filtering or upstream morphology.",
    }
    fp32 = model_dir / "delineate-v2-512-fp32.onnx"
    if not fp32.exists():
        started = time.perf_counter()
        path = YOLO(str(checkpoint)).export(format="onnx", imgsz=512, opset=17, dynamic=False, simplify=True, half=False, device="cpu", nms=False)
        shutil.move(path, fp32)
        report["exportSeconds"] = time.perf_counter() - started
    graph = onnx.load(fp32)
    onnx.checker.check_model(graph)
    report["operators"] = dict(Counter(node.op_type for node in graph.graph.node))
    fp16 = model_dir / "delineate-v2-512-fp16.onnx"
    if not fp16.exists():
        half_graph = convert_float_to_float16(graph, keep_io_types=True, disable_shape_infer=False)
        # The converter appends input/output casts; slimming restores topological order.
        half_graph = onnxslim.slim(half_graph)
        onnx.checker.check_model(half_graph)
        onnx.save(half_graph, fp16)
    for key, path in [("fp32", fp32), ("fp16", fp16)]:
        report["models"][key] = {"url": f"models/{path.name}", "bytes": path.stat().st_size, "sha256": digest(path)}

    started = time.perf_counter()
    session = ort.InferenceSession(str(fp32), providers=["CPUExecutionProvider"])
    report["nativeOnnxLoadSeconds"] = time.perf_counter() - started
    report["outputs"] = [{"name": item.name, "shape": item.shape, "type": item.type} for item in session.get_outputs()]
    torch_model = YOLO(str(checkpoint)).model.float().eval()
    # Export mode emits the two decoded raw heads for shape-for-shape comparison.
    torch_model.model[-1].export = True
    torch_model.model[-1].format = "onnx"
    samples_out = output / "samples"
    samples_out.mkdir(exist_ok=True)
    for name in ["salinas", "iowa-farm", "iowa"]:
        image_path = args.samples / f"{name}.jpg"
        image = cv2.imread(str(image_path))
        if image is None:
            raise ValueError(f"Cannot read {image_path}")
        if image.shape[:2] != (1024, 1024):
            raise ValueError("Parity fixtures deliberately require unchanged 1024px square public samples")
        small = cv2.resize(image, (512, 512), interpolation=cv2.INTER_LINEAR)
        rgb = np.ascontiguousarray(small[:, :, ::-1].transpose(2, 0, 1)[None], dtype=np.float32) / 255
        rgb.tofile(samples_out / f"{name}-input.bin")
        shutil.copy2(image_path, samples_out / f"{name}.jpg")
        with torch.inference_mode():
            reference = [item.detach().numpy() for item in torch_model(torch.from_numpy(rgb))]
        native_times = []
        for _ in range(2):
            started = time.perf_counter()
            actual = session.run(None, {session.get_inputs()[0].name: rgb})
            native_times.append(time.perf_counter() - started)
        comparison = []
        for index, (expected, received) in enumerate(zip(reference, actual, strict=True)):
            expected.tofile(samples_out / f"{name}-output{index}.bin")
            comparison.append({"shape": list(expected.shape), "maxAbsDiff": float(np.max(np.abs(expected - received))), "meanAbsDiff": float(np.mean(np.abs(expected - received)))})
        report["samples"].append({"name": name, "image": f"samples/{name}.jpg", "input": f"samples/{name}-input.bin", "reference": [f"samples/{name}-output{index}.bin" for index in range(len(reference))], "imageSha256": digest(image_path), "nativeOnnxSeconds": native_times, "nativeParity": comparison})
    (output / "manifest.json").write_text(json.dumps(report, indent=2) + "\n")
    for filename in ["index.html", "experiment.js"]:
        shutil.copy2(Path(__file__).parent / filename, output / filename)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
