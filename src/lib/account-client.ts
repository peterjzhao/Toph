import type { AccountSession, AuthResponse } from "@/contracts/accounts";

export class AccountRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function accountRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, cache: "no-store", headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json();
  if (!response.ok) throw new AccountRequestError(body.error?.message ?? "Something went wrong. Please try again.", response.status);
  return body as T;
}

export function accountDestination(session: AccountSession): string {
  if (session.account.role !== "admin") return "/login?worker=1";
  return session.farm.setupComplete ? "/" : "/onboarding";
}

export async function currentAccount(): Promise<AccountSession> {
  return (await accountRequest<AuthResponse>("/api/auth/session")).data;
}
