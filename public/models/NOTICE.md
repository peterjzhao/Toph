Pinned Delineate Anything v2 FP32 ONNX export used by Toph's browser field detection.

- Model authors: Mykola Lavreniuk and Delineate Anything contributors.
- Official source: https://github.com/Lavreniuk/Delineate-Anything/tree/278a3d91e78535174e2a80865a67c77e855d3a91
- Official checkpoint: https://huggingface.co/MykolaL/DelineateAnything/tree/cff6ad11e3a0a7ccdcf1261fefb148309b5d6a8a
- License: AGPL-3.0; the upstream license is included as a release asset.
- Export recipe and exact dependencies: https://github.com/peterjzhao/Toph/tree/5a75f97f8738345e43152a56649ef26982cac792/scripts/experiments/browser-segmentation
- ONNX input: RGB float32, 1 x 3 x 512 x 512; opset 17; weights are an unquantized export of the pinned checkpoint.
- Artifact bytes: 248344427.
- SHA-256: 381f3b4815c5fae895971121ded05a83733c9439dff4b28a56b590e334d85b37.

This artifact is downloaded and hash-checked during the Vercel build, served as a static asset, and executed on the user's device. No farm image or server secret is included.
