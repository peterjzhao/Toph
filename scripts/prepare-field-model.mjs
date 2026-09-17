/** Download the pinned browser model during deployment; never bundle it into a function. */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const name = "delineate-v2-512-fp32.onnx";
const url = `https://github.com/peterjzhao/Toph/releases/download/field-model-v2-512-fp32-1/${name}`;
const expectedBytes = 248344427;
const expectedHash = "381f3b4815c5fae895971121ded05a83733c9439dff4b28a56b590e334d85b37";
const target = new URL(`../public/models/${name}`, import.meta.url);

async function verified(path) {
  if (await stat(path).then(info => info.size !== expectedBytes).catch(() => true)) return false;
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex") === expectedHash;
}

if (process.env.NEXT_PUBLIC_FIELD_MODEL_URL?.trim()) {
  console.log("Field detection uses the configured public model URL.");
} else if (await verified(target)) {
  console.log("Pinned field model verified; using the existing static asset.");
} else {
  await mkdir(new URL("../public/models/", import.meta.url), { recursive: true });
  const temporary = new URL(`${target.href}.download`);
  try {
    console.log("Downloading the pinned field model for browser inference…");
    const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
    if (!response.ok || !response.body) throw new Error(`Field model download failed (${response.status}).`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
    if (!await verified(temporary)) throw new Error("Field model size or SHA-256 did not match the pinned artifact.");
    await rename(temporary, target);
    console.log("Field model verified and ready in public/models.");
  } finally { await rm(temporary, { force: true }); }
}
