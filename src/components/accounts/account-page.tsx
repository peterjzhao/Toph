"use client";

import { useState, type FormEvent } from "react";
import { Copy, Check, ArrowRight } from "lucide-react";
import { PASSWORD_MAX_LENGTH, type AccountSession } from "@/contracts/accounts";
import { accountDestination, accountRequest } from "@/lib/account-client";
import { useWorkspace } from "../workspace/workspace-provider";
import { PageHeader } from "../workspace/workspace-ui";
import s from "../workspace/workspace.module.css";
import styles from "./accounts.module.css";

export function InviteCode({ compact = false }: { compact?: boolean }) {
  const { account } = useWorkspace();
  const code = account.joinCode ?? "";
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  return <div className={compact ? undefined : styles.accountCard}>
    {compact ? <h3 style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "#555" }}>Farm code</h3> : <h2>Farm code</h2>}
    <div className={styles.joinCode}><code aria-label="Farm join code">{code || "No code yet"}</code>{code && <button className={styles.secondaryButton} onClick={async () => { try { await navigator.clipboard.writeText(code); setCopied(true); } catch { setError("Select and copy the code above."); } }}>{copied ? <Check size={16}/> : <Copy size={16}/>}{copied ? "Copied" : "Copy code"}</button>}</div>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </div>;
}

/** Each account belongs to one farm, so switching farms means signing in to that farm's account. */
export function SwitchUserPage() {
  const { account } = useWorkspace();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await accountRequest<{ data: AccountSession }>("/api/auth/login", { method: "POST", body: JSON.stringify({ name, password }) });
      window.location.assign(accountDestination(response.data));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "We couldn’t switch farms. Please try again."); setBusy(false); }
  }
  return <div className={s.page}><PageHeader title="Switch User" description={`You’re in ${account.farm.name} as ${account.account.name}.`} />
    <section className={styles.accountCard}><h2>Switch to another farm</h2>
      <form className={s.form} style={{ marginTop: 18 }} onSubmit={event => void submit(event)}>
        <label>Name<input required name="username" autoComplete="username" maxLength={80} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
        <label>Password<input required type="password" name="password" autoComplete="current-password" maxLength={PASSWORD_MAX_LENGTH} value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></label>
        {error && <p className={s.formError} role="alert">{error}</p>}
        <div className={s.formActions}><button type="submit" className={styles.primaryButton} disabled={busy || !name.trim() || !password}>{busy ? "Switching…" : "Switch farm"}<ArrowRight size={15}/></button></div>
      </form>
    </section>
  </div>;
}
