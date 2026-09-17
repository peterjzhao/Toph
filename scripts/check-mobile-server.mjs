/** Read-only checks for the hosted mobile demo, safe to run after a deployment. */
const origin = new URL(process.argv[2] || "https://toph-rho.vercel.app");
if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
  throw new Error("Pass only the server origin, without credentials, a path, or a query.");
}

async function read(path) {
  const response = await fetch(new URL(path, origin), {
    headers: { Accept: "application/json", "X-Toph-Client": "toph-mobile" },
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = response.status === 404 ? "The deployment does not contain the mobile routes yet."
      : body?.error?.message || "Check the Vercel deployment and environment settings.";
    throw new Error(`${path}: HTTP ${response.status}. ${reason}`);
  }
  if (!body || !("data" in body)) throw new Error(`${path}: Invalid API response.`);
  return body.data;
}

try {
  const health = await read("/api/health");
  if (health.database !== "connected") throw new Error("The server cannot reach its database.");
  console.log("PASS  Server is connected to PostgreSQL.");
  const bootstrap = await read("/api/mobile/v1/accounts");
  if (bootstrap.mode !== "demo" || !bootstrap.farm?.id || !bootstrap.accounts?.length || !bootstrap.fields?.length) {
    throw new Error("The mobile demo did not return a farm, accounts, and fields.");
  }
  console.log(`PASS  Mobile demo has ${bootstrap.accounts.length} account(s) and ${bootstrap.fields.length} field(s).`);
  const logs = await read(`/api/mobile/v1/logs?accountId=${encodeURIComponent(bootstrap.accounts[0].id)}`);
  if (!Array.isArray(logs)) throw new Error("The account log list is invalid.");
  console.log("PASS  Account logs load. Reopen Toph on the phone to connect.");
} catch (error) {
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
