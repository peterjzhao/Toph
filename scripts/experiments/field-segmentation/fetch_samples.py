#!/usr/bin/env python3
"""Fetch two farm samples and a lake control from USDA NAIP, with actual extents."""
import argparse
import json
import urllib.parse
import urllib.request
from pathlib import Path

SERVICE = "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer"
SAMPLES = {"salinas": [-121.80, 36.82, -121.78, 36.836], "iowa": [-93.64, 42.06, -93.62, 42.076], "iowa-farm": [-93.80, 42.06, -93.78, 42.076]}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(".local/field-segmentation/samples"))
    parser.add_argument("--sample", choices=list(SAMPLES), help="Fetch only this sample")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    for name, bbox in SAMPLES.items():
        if args.sample and args.sample != name:
            continue
        request = SERVICE + "/exportImage?" + urllib.parse.urlencode({"bbox": ",".join(map(str,bbox)), "bboxSR":4326, "imageSR":3857, "size":"1024,1024", "format":"jpg", "f":"json"})
        with urllib.request.urlopen(request, timeout=60) as response:
            result = json.load(response)
        if "error" in result or "href" not in result:
            raise RuntimeError(result)
        # The service may adjust the extent for square pixels; preserve its response.
        result.update({"request":request, "attribution":"USDA NAIP / USGS The National Map", "description":f"Real aerial imagery: {name}. Acquisition date not verified; not a parcel ground-truth dataset."})
        with urllib.request.urlopen(result["href"], timeout=60) as response:
            (args.output / f"{name}.jpg").write_bytes(response.read())
        (args.output / f"{name}-source.json").write_text(json.dumps(result, indent=2))
        print(f"Saved {name}", flush=True)

if __name__ == "__main__":
    main()
