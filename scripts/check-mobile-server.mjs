/** Read-only deployment check. Optional TOPH_MOBILE_TOKEN verifies a worker's data too. */
import { pathToFileURL } from "node:url";

export async function checkMobileServer({ server = "https://toph-rho.vercel.app", token = "", fetcher = fetch, log = console.log } = {}) {
  const origin = new URL(server);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || (origin.protocol !== "https:" && !(local && origin.protocol === "http:"))) {
    throw new Error("Pass an HTTPS server origin (or HTTP localhost), without credentials, a path, or a query.");
  }
  async function read(path, credential = "", expectedStatus = 200) {
    const response = await fetcher(new URL(path, origin), {
      headers: { Accept: "application/json", "X-Toph-Client": "toph-mobile", ...(credential ? { Authorization: `Bearer ${credential}` } : {}) },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => null);
    if (response.status !== expectedStatus) {
      throw new Error(`${path}: expected HTTP ${expectedStatus}, received ${response.status}. ${response.status === 404 ? "Deploy the latest account and inbox routes." : body?.error?.code || "Check deployment configuration."}`);
    }
    if (expectedStatus === 401) {
      if (body?.error?.code !== "UNAUTHORIZED") throw new Error(`${path}: missing authentication error envelope.`);
      return null;
    }
    if (!body || !("data" in body)) throw new Error(`${path}: invalid API response.`);
    return body.data;
  }
  const health = await read("/api/health");
  if (health.database !== "connected") throw new Error("The server cannot reach PostgreSQL.");
  log("PASS  Server is connected to PostgreSQL.");
  for (const path of ["/api/auth/session", "/api/mobile/v1/accounts", "/api/mobile/v1/messages", "/api/messages"]) await read(path, "", 401);
  log("PASS  Account and inbox routes are deployed and reject anonymous requests.");
  if (!token) {
    log("INFO  Set TOPH_MOBILE_TOKEN to an existing worker session for private-data checks. No send/read mutations were performed.");
    return;
  }
  const session = await read("/api/auth/session", token);
  if (session.account?.role !== "worker" || !session.account.employeeId || !session.farm?.id) throw new Error("Use an active worker session.");
  const bootstrap = await read("/api/mobile/v1/accounts", token);
  if (bootstrap.farm?.id !== session.farm.id || bootstrap.accounts?.length !== 1 || bootstrap.accounts[0].id !== session.account.employeeId || !Array.isArray(bootstrap.fields)) {
    throw new Error("Mobile bootstrap does not match the signed-in worker.");
  }
  const logs = await read(`/api/mobile/v1/logs?accountId=${encodeURIComponent(session.account.employeeId)}`, token);
  if (!Array.isArray(logs) || logs.some(item => item.employee?.id !== session.account.employeeId)) throw new Error("Log history does not match the worker.");
  const inbox = await read("/api/mobile/v1/messages", token);
  if (!Array.isArray(inbox.messages) || !Number.isInteger(inbox.revision) || inbox.messages.some(item => item.employeeId !== session.account.employeeId)) throw new Error("Inbox does not match the worker.");
  log(`PASS  Private worker bootstrap, logs, and inbox load (${inbox.messages.length} messages). No messages were sent or marked read.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkMobileServer({ server: process.argv[2], token: process.env.TOPH_MOBILE_TOKEN?.trim() }).catch(error => {
    console.error(`FAIL  ${error instanceof Error ? error.message : "Deployment check failed."}`);
    process.exitCode = 1;
  });
}
