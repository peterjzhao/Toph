#!/usr/bin/env python3
"""Static-only test server. No uploads, inference endpoint, or database access."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class Handler(SimpleHTTPRequestHandler):
    # esbuild bundles the production worker to its original URL basename so the
    # unmodified detectFields(new URL(..., import.meta.url)) can be tested here.
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".ts": "text/javascript"}


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--directory", default=".local/browser-segmentation/site")
parser.add_argument("--port", type=int, default=8768)
args = parser.parse_args()
ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, directory=args.directory)).serve_forever()
