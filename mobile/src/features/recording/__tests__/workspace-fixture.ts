import type { AccountSession } from "@toph/contracts/accounts";
import type { MobileBootstrap } from "@toph/contracts/mobile";

export const employeeId = "10000000-0000-4000-8000-000000000001";
export const farmId = "00000000-0000-4000-8000-000000000001";
export const workerBootstrap: MobileBootstrap = {
  mode: "shared", revision: 1, maxAudioBytes: 3_800_000,
  farm: { id: farmId, name: "Bays Ranch", timezone: "America/Los_Angeles" },
  fields: [{ id: "20000000-0000-4000-8000-000000000001", name: "FIELD A" }],
  accounts: [{ id: employeeId, name: "Isaac Wang", role: "Farm worker", email: "", phone: "", avatarUrl: null, defaultField: "FIELD A", defaultActivity: "Spraying" }],
};

export function workspaceProps(initialBootstrap = workerBootstrap) {
  const session: AccountSession = {
    account: { id: `account-${initialBootstrap.accounts[0].id}`, name: initialBootstrap.accounts[0].name, role: "worker", employeeId: initialBootstrap.accounts[0].id },
    farm: { ...initialBootstrap.farm, setupComplete: initialBootstrap.fields.length > 0 },
  };
  return { session, initialBootstrap, onSignOut: jest.fn(async () => {}) };
}
