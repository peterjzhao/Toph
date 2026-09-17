import { File, Paths } from "expo-file-system";
import type { MobileBootstrap } from "@toph/contracts/mobile";
import { storageDirectoryName } from "./local-drafts";
import { apiOrigin } from "@/lib/api/mobile-client";
export type SavedAccounts = { origin: string; activeId: string; bootstrap: MobileBootstrap };
const file = () => new File(Paths.document, storageDirectoryName, "accounts.json");
export function readAccounts(): SavedAccounts | null {
  try {
    const stored = file();
    if (!stored.exists) return null;
    const data = JSON.parse(stored.textSync()) as SavedAccounts;
    if (data.origin !== apiOrigin() || !["shared", "demo"].includes(data.bootstrap?.mode) || !Array.isArray(data.bootstrap.accounts) || !data.bootstrap.accounts.some(item => item.id === data.activeId)) return null;
    return { ...data, bootstrap: { ...data.bootstrap, mode: "shared" } };
  } catch { return null; }
}
export function saveAccounts(bootstrap: MobileBootstrap, activeId: string) {
  const target = file();
  if (!target.parentDirectory.exists) target.parentDirectory.create({ intermediates: true, idempotent: true });
  if (!target.exists) target.create();
  target.write(JSON.stringify({ origin: apiOrigin(), activeId, bootstrap } satisfies SavedAccounts));
}
