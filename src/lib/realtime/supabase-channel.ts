import { parseLiveUpdateSignal } from "./changes";
import type { EnabledRealtimeConfig, LiveChannelStatus, LiveConnection, LiveConnectionHandlers } from "./live-updates";

/**
 * Supabase Realtime adapter for live updates: one socket, one private broadcast channel.
 *
 * Only the Realtime client is used (no Supabase data, auth, or storage client), and it is
 * loaded on demand so dashboards without live updates never download it. The publishable key
 * authorizes this connection as the `anon` role, which may only receive on the farm topic.
 * The library keeps the socket alive with heartbeats and rejoins the channel with backoff
 * after a drop; every successful join is reported as SUBSCRIBED.
 */
export async function connectSupabaseChannel(config: EnabledRealtimeConfig, handlers: LiveConnectionHandlers): Promise<LiveConnection> {
  const { RealtimeClient } = await import("@supabase/realtime-js");
  const client = new RealtimeClient(`${config.url}/realtime/v1`, { params: { apikey: config.key } });
  const channel = client.channel(config.topic, { config: { private: true } });
  channel.on("broadcast", { event: config.event }, (message) => {
    const kind = parseLiveUpdateSignal(message.payload);
    if (kind) handlers.onSignal(kind);
  });
  channel.subscribe((status, error) => handlers.onStatus(status as LiveChannelStatus, error));
  return {
    reconnect() { if (!client.isConnected()) client.connect(); },
    async close() {
      await client.removeChannel(channel);
      await client.disconnect();
    },
  };
}
