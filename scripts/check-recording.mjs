/** Live speech/extraction smoke check. Uses the selected server, incurs AI usage, saves no log. */
import { readFile } from "node:fs/promises";
import path from "node:path";

try {
  const audioPath = process.argv[2];
  if (!audioPath) throw new Error("Usage: npm run check:recording -- <audio-file> [server-origin]");
  const origin = new URL(process.argv[3] || "https://toph-rho.vercel.app");
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Use a server origin without credentials or a path.");
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname);
  if (origin.protocol !== "https:" && !(local && origin.protocol === "http:")) throw new Error("Use HTTPS for a remote server.");
  const extension = path.extname(audioPath).toLowerCase();
  const mime = { ".m4a": "audio/mp4", ".mp4": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".webm": "audio/webm" }[extension];
  if (!mime) throw new Error("Use an M4A, MP4, MP3, WAV or WebM file.");
  const audio = await readFile(audioPath);
  if (!audio.length || audio.length > 3_800_000) throw new Error("Use a nonempty recording under 3.8 MB.");
  const headers = { Accept: "application/json", "X-Toph-Client": "toph-mobile" };
  async function data(response) {
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${body?.error?.message || "Check the deployment and server configuration."}`);
    if (!body?.data) throw new Error("The server returned an invalid response.");
    return body.data;
  }
  const bootstrap = await data(await fetch(new URL("/api/mobile/v1/accounts", origin), { headers, redirect: "error", signal: AbortSignal.timeout(30_000) }));
  if (!bootstrap.accounts?.length) throw new Error("No active farm account is available.");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: bootstrap.farm.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const datePart = type => parts.find(part => part.type === type)?.value;
  const referenceDate = `${datePart("year")}-${datePart("month")}-${datePart("day")}`;
  const form = new FormData();
  form.append("file", new Blob([audio], { type: mime }), path.basename(audioPath));
  form.append("context", JSON.stringify({ accountId: bootstrap.accounts[0].id, referenceDate }));
  const result = await data(await fetch(new URL("/api/mobile/v1/transcriptions", origin), {
    method: "POST", headers, body: form, redirect: "error", signal: AbortSignal.timeout(120_000),
  }));
  console.log(JSON.stringify(result, null, 2));
  if (!result.transcript || !result.fields || result.extractionError) throw new Error("Speech or field extraction did not complete.");
  console.log("PASS  Live transcription and structured extraction completed. No work log was saved.");
} catch (error) {
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
