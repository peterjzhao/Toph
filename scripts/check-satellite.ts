/**
 * End-to-end check of the Copernicus path: token, catalogue, statistics and one rendered frame.
 *
 * Run with `npm run check:satellite`. This is the only thing that exercises the live CDSE APIs;
 * the unit tests all use mocked fetchers. It reads no database and writes nothing, so it is safe
 * against a production environment file — it only spends a few processing units.
 *
 * Bays Ranch's placeholder extent is used as the area of interest, because it is a real place on
 * the earth with Sentinel-2 coverage. See src/server/db/bays-field-map.ts.
 */
import type { FieldPoint } from "@/contracts/accounts";
import { BAYS_FIELD_BOUNDARIES, BAYS_PLACEHOLDER_EXTENT } from "@/server/db/bays-field-map";
import { monthlySpine, searchAcquisitions } from "@/server/satellite/catalog";
import { cdseCredentials, cdseToken } from "@/server/satellite/client";
import { parseFarmExtent } from "@/server/satellite/extent";
import { renderFrame } from "@/server/satellite/imagery";
import { MIN_VALID_FRACTION, fetchFieldStatistics } from "@/server/satellite/statistics";
import { ARCHIVE_START } from "@/server/satellite/service";
import { loadLocalEnv } from "./db/lib/env";

let failures = 0;
const report = (ok: boolean, message: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${message}`);
};
const note = (message: string) => console.log(`      ${message}`);
const since = (start: number) => `${Math.round(performance.now() - start)} ms`;

/** Shifts a YYYY-MM-DD date by whole months, clamped to the first of the month. */
function monthsBefore(date: string, count: number): string {
  const [year, month] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 - count, 1));
  return shifted.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  loadLocalEnv();
  const today = new Date().toISOString().slice(0, 10);

  let credentials;
  try {
    credentials = cdseCredentials();
  } catch {
    report(false, "CDSE_CLIENT_ID and CDSE_CLIENT_SECRET are set (add them to .env.local)");
    process.exitCode = 1;
    return;
  }
  report(true, `credentials present (client id ${credentials.clientId.slice(0, 4)}…, secret hidden)`);

  const extent = parseFarmExtent(BAYS_PLACEHOLDER_EXTENT);
  note(`area of interest: Bays Ranch placeholder extent, ${Math.round(extent.maxX - extent.minX)} × ${Math.round(extent.maxY - extent.minY)} m`);

  let token: string;
  const tokenStart = performance.now();
  try {
    token = await cdseToken(credentials);
    report(true, `token obtained in ${since(tokenStart)}`);
  } catch (error) {
    report(false, `token request failed: ${error instanceof Error ? error.message : String(error)}`);
    note("Check the client id and secret in the Sentinel Hub dashboard; a client can also expire.");
    process.exitCode = 1;
    return;
  }

  const catalogStart = performance.now();
  const passes = await searchAcquisitions(extent, { from: ARCHIVE_START, to: today }, token);
  report(passes.length > 0, `catalogue: ${passes.length} pass(es) since ${ARCHIVE_START} in ${since(catalogStart)}`);
  if (!passes.length) {
    note("No Sentinel-2 coverage for this area. Nothing further can be checked.");
    process.exitCode = 1;
    return;
  }

  const months = monthlySpine(passes);
  report(months.length > 0, `timeline: ${months.length} scrubber stop(s), ${months[0]?.month} → ${months.at(-1)?.month}`);
  const latest = months.at(-1);
  if (!latest) {
    note("Every pass was too cloudy to use. Try again when the archive has a clearer month.");
    process.exitCode = 1;
    return;
  }
  note(`newest usable pass: ${latest.date} at ${Math.round(latest.cloudCover)}% cloud`);

  const boundary: FieldPoint[] = BAYS_FIELD_BOUNDARIES.A.map(([x, y]) => ({ x, y }));
  const from = monthsBefore(latest.date, 3);
  const statsStart = performance.now();
  const observations = await fetchFieldStatistics(boundary, extent, { from, to: latest.date }, token);
  report(observations.length > 0, `statistics: ${observations.length} reading(s) for Field A, ${from} → ${latest.date}, in ${since(statsStart)}`);
  if (observations.length) {
    const first = observations[0], last = observations.at(-1)!;
    note(`NDVI ${first.mean.toFixed(3)} on ${first.date} → ${last.mean.toFixed(3)} on ${last.date}`);
    note(`field visible: ${observations.map(item => `${Math.round(item.validFraction * 100)}%`).join(", ")}`);
    report(observations.every(item => item.validFraction >= MIN_VALID_FRACTION),
      `cloud guard held: every reading is at least ${Math.round(MIN_VALID_FRACTION * 100)}% clear`);
  } else {
    note(`No reading passed the ${Math.round(MIN_VALID_FRACTION * 100)}% cloud guard in this window. That is a normal outcome in a cloudy season, not a failure of the credentials.`);
  }

  for (const layer of ["true-colour", "ndvi"] as const) {
    const frameStart = performance.now();
    const frame = await renderFrame(extent, latest.date, layer, token);
    const isPng = frame.bytes.subarray(0, 4).equals(Buffer.from([137, 80, 78, 71]));
    report(isPng && frame.bytes.length > 1000,
      `frame "${layer}": ${(frame.bytes.length / 1024).toFixed(0)} KB PNG in ${since(frameStart)}`);
  }

  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed. The satellite timeline is wired end to end.");
  if (failures) process.exitCode = 1;
}

main().catch(error => {
  console.error(`\nUnexpected failure: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
