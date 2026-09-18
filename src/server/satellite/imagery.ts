import "server-only";
/**
 * One rendered Sentinel-2 frame for a farm, date and layer.
 *
 * Cloud is left visible rather than masked out: a farmer looking at a frame should see the weather
 * that explains a gap in the readings instead of a doctored clear day.
 */
import type { Layer } from "@/contracts/satellite";
import { CDSE_PROCESS_URL, SENTINEL2_COLLECTION, cdseRequest, satelliteUnavailable } from "./client";
import { imageEvalscript } from "./evalscripts";
import { EPSG_3857_URN, extentBbox, frameSize, type FarmExtent } from "./extent";

/** Upper bound on a frame's long edge. Sentinel-2's own 10 m resolution usually binds first. */
export const MAX_FRAME_PIXELS = 1024;
/** PNG, not JPEG: the evalscripts carry dataMask in the alpha channel. */
const FRAME_CONTENT_TYPE = "image/png";

export type Frame = { bytes: Buffer; contentType: string };

export async function renderFrame(extent: FarmExtent, date: string, layer: Layer, token: string, fetcher: typeof fetch = fetch): Promise<Frame> {
  const { width, height } = frameSize(extent, MAX_FRAME_PIXELS);
  const response = await cdseRequest(CDSE_PROCESS_URL, token, {
    input: {
      bounds: { bbox: extentBbox(extent), properties: { crs: EPSG_3857_URN } },
      data: [{
        type: SENTINEL2_COLLECTION,
        dataFilter: { timeRange: { from: `${date}T00:00:00Z`, to: `${date}T23:59:59Z` }, mosaickingOrder: "leastCC" },
      }],
    },
    output: { width, height, responses: [{ identifier: "default", format: { type: FRAME_CONTENT_TYPE } }] },
    evalscript: imageEvalscript(layer),
  }, fetcher, FRAME_CONTENT_TYPE);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw satelliteUnavailable();
  return { bytes, contentType: FRAME_CONTENT_TYPE };
}
