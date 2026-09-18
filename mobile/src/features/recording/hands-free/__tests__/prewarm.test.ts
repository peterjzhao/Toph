import type { VoiceSession } from "@toph/contracts/voice";
import { createSessionWarmer } from "../prewarm";

const minted = (expiresInMs: number, now: number): VoiceSession => ({
  clientSecret: "ek_test", expiresAt: new Date(now + expiresInMs).toISOString(), model: "gpt-realtime-2.1",
  connectUrl: "https://api.openai.com/v1/realtime/calls", dataChannel: "oai-events", toolName: "check_log", maxSessionSeconds: 300,
});
const flush = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };

function harness(mint?: jest.Mock) {
  let clock = 1_000_000;
  const session = mint ?? jest.fn(async () => minted(120_000, clock));
  const warmer = createSessionWarmer({ session, now: () => clock });
  return { warmer, session, tick: (ms: number) => { clock += ms; } };
}

test("mints once while a secret is still in flight", async () => {
  const { warmer, session } = harness();
  warmer.warm(); warmer.warm(); warmer.warm();
  await flush();
  expect(session).toHaveBeenCalledTimes(1);
});

test("keeps a warm secret rather than minting again", async () => {
  const { warmer, session, tick } = harness();
  warmer.warm();
  await flush();
  tick(30_000);
  warmer.warm();
  await flush();
  expect(session).toHaveBeenCalledTimes(1);
});

test("mints again once the held secret is close to expiry", async () => {
  const { warmer, session, tick } = harness();
  warmer.warm();
  await flush();
  // 120s secret, 20s lead: still good at 95s, stale at 105s.
  tick(95_000);
  warmer.warm();
  await flush();
  expect(session).toHaveBeenCalledTimes(1);
  tick(10_000);
  warmer.warm();
  await flush();
  expect(session).toHaveBeenCalledTimes(2);
});

test("hands the warmed session to the first taker and nothing to the second", async () => {
  const { warmer } = harness();
  warmer.warm();
  await flush();
  const taken = warmer.take();
  expect(taken).not.toBeNull();
  await expect(taken).resolves.toMatchObject({ clientSecret: "ek_test" });
  expect(warmer.take()).toBeNull();
});

test("withholds a secret that went stale before the tap, so the caller mints fresh", async () => {
  const { warmer, tick } = harness();
  warmer.warm();
  await flush();
  tick(115_000);
  expect(warmer.take()).toBeNull();
});

test("takes an in-flight mint that has not resolved yet", async () => {
  let resolve!: (session: VoiceSession) => void;
  const session = jest.fn(() => new Promise<VoiceSession>(done => { resolve = done; }));
  const { warmer } = harness(session);
  warmer.warm();
  const taken = warmer.take();
  expect(taken).not.toBeNull();
  resolve(minted(120_000, 1_000_000));
  await expect(taken).resolves.toMatchObject({ clientSecret: "ek_test" });
});

test("drops a failed mint so the next warm retries and nothing stale is handed out", async () => {
  const session = jest.fn(async () => { throw new Error("Voice conversation is busy."); });
  const { warmer } = harness(session);
  warmer.warm();
  await flush();
  expect(warmer.take()).toBeNull();
  warmer.warm();
  await flush();
  expect(session).toHaveBeenCalledTimes(2);
});

test("clear drops a held secret", async () => {
  const { warmer } = harness();
  warmer.warm();
  await flush();
  warmer.clear();
  expect(warmer.take()).toBeNull();
});
