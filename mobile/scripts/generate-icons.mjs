import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const asset = (path) => new URL(`../assets/${path}`, import.meta.url);
const svg = await readFile(asset("images/icon.svg"), "utf8");
const background = /\s*<rect id="background"[^>]*\/>/;
if (!background.test(svg)) throw new Error("icon.svg must have a background rect with id=background");
const foreground = svg.replace(background, "");

// Use a Toph-specific asset name so iOS doesn't reuse the starter icon's
// compiled/cached layers during the home-screen launch animation.
await writeFile(asset("toph.icon/Assets/toph-t.svg"), foreground);
await sharp(Buffer.from(svg)).removeAlpha().png().toFile(fileURLToPath(asset("images/icon.png")));
await sharp(Buffer.from(svg)).resize(64, 64).removeAlpha().png().toFile(fileURLToPath(asset("images/favicon.png")));

// Android's 108dp adaptive canvas has a 72dp visible area. Scale around the
// center so the t keeps its intended size and fits all launcher masks.
const adaptive = foreground
  .replace(/<path\b/, '<g transform="translate(512 512) scale(0.666666667) translate(-512 -512)"><path')
  .replace("</svg>", "</g></svg>");
const android = await sharp(Buffer.from(adaptive)).png().toBuffer();
await writeFile(asset("images/android-icon-foreground.png"), android);
await writeFile(asset("images/android-icon-monochrome.png"), android);
console.log("Generated Toph iOS, Android, and web icons from assets/images/icon.svg");
