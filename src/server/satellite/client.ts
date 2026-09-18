import "server-only";
/**
 * Copernicus Data Space Ecosystem access.
 *
 * Credentials are server-only and never reach the browser, matching OPENAI_API_KEY. Tokens are
 * short-lived and cached per server instance; a cold start simply fetches another one.
 */
import { ApiError, notConfigured } from "@/server/errors";

const CDSE_HOST = "https://sh.dataspace.copernicus.eu";
export const CDSE_TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
export const CDSE_CATALOG_URL = `${CDSE_HOST}/api/v1/catalog/1.0.0/search`;
export const CDSE_PROCESS_URL = `${CDSE_HOST}/api/v1/process`;
export const CDSE_STATISTICS_URL = `${CDSE_HOST}/api/v1/statistics`;
export const SENTINEL2_COLLECTION = "sentinel-2-l2a";

/** Tokens last ten minutes upstream; refresh a minute early so an in-flight request cannot expire. */
const TOKEN_SAFETY_MARGIN_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

export type CdseCredentials = { clientId: string; clientSecret: string };
export type TokenCache = { current: { token: string; expiresAt: number } | null };

export const satelliteUnavailable = () =>
  new ApiError(502, "INTERNAL_ERROR", "Satellite imagery isn’t available right now. Please try again.");

export function cdseCredentials(env: NodeJS.ProcessEnv = process.env): CdseCredentials {
  const clientId = env.CDSE_CLIENT_ID?.trim(), clientSecret = env.CDSE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw notConfigured("Satellite imagery needs server Copernicus credentials.");
  return { clientId, clientSecret };
}

const moduleTokenCache: TokenCache = { current: null };

/** Client-credentials grant. The cache is a parameter so callers and tests can hold their own. */
export async function cdseToken(
  credentials: CdseCredentials,
  fetcher: typeof fetch = fetch,
  cache: TokenCache = moduleTokenCache,
  now: number = Date.now(),
): Promise<string> {
  if (cache.current && cache.current.expiresAt > now) return cache.current.token;
  let response: Response;
  try {
    response = await fetcher(CDSE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: credentials.clientId, client_secret: credentials.clientSecret }),
    });
  } catch {
    throw satelliteUnavailable();
  }
  if (!response.ok) throw satelliteUnavailable();
  const body = await response.json().catch(() => null) as { access_token?: unknown; expires_in?: unknown } | null;
  if (typeof body?.access_token !== "string" || !body.access_token) throw satelliteUnavailable();
  const lifetimeMs = (typeof body.expires_in === "number" ? body.expires_in : 600) * 1000;
  cache.current = { token: body.access_token, expiresAt: now + Math.max(0, lifetimeMs - TOKEN_SAFETY_MARGIN_MS) };
  return body.access_token;
}

/** Shared POST helper: bearer auth, a bounded timeout, and no upstream detail in the thrown error. */
export async function cdseRequest(url: string, token: string, body: unknown, fetcher: typeof fetch, accept = "application/json"): Promise<Response> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: accept },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify(body),
    });
  } catch {
    throw satelliteUnavailable();
  }
  if (!response.ok) throw satelliteUnavailable();
  return response;
}
