import type { AccountSession } from "@toph/contracts/accounts";
import type { MobileBootstrap } from "@toph/contracts/mobile";

export function sessionAccount(bootstrap: MobileBootstrap, session: AccountSession) {
  const account = bootstrap.accounts.find(item => item.id === session.account.employeeId);
  if (session.account.role !== "worker" || !account || bootstrap.farm.id !== session.farm.id || bootstrap.accounts.length !== 1) {
    throw new Error("Your farm account could not be verified. Sign out and log in again.");
  }
  return account;
}
