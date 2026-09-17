#!/usr/bin/env python3
"""Delineate Anything v2 model-only comparison; not the full tiled GIS pipeline."""
from run_fastsam import main
from ultralytics import YOLO

REVISION = "cff6ad11e3a0a7ccdcf1261fefb148309b5d6a8a"

if __name__ == "__main__":
    main({
        "family": "Delineate Anything", "variants": ["v2"], "factory": YOLO,
        "prefix": "delany-v2", "weights": "delany-v2/DelineateAnythingv2.pt",
        "revision": REVISION, "sizes": [512, 1024], "confidence": 0.15, "nmsIoU": 0.7,
        "semanticClass": "field", "description": __doc__,
        "preferred": "Delineate Anything-v2 · 512px",
        "intro": "Delineate Anything v2 is trained specifically to propose agricultural field boundaries.",
        "notes": "Raw RGB, full-image model-only test at trained 512px and comparison 1024px. No land-cover mask, tiling, percentile stretch, morphology or GIS polygon merging. FP32/MPS; confidence floor 0.15; NMS IoU 0.7. Not upstream pipeline parity.",
        "uiNotes": "This is the field-trained model on one RGB image, without the authors' tiled GIS cleanup or land-cover filtering.",
    })
