"use client";

import Link from "next/link";
import { useState } from "react";
import { Copy, Check, ArrowRight } from "lucide-react";
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
    <h2>Farm code</h2>
    <div className={styles.joinCode}><code aria-label="Farm join code">{code || "No code yet"}</code>{code && <button className={styles.secondaryButton} onClick={async () => { try { await navigator.clipboard.writeText(code); setCopied(true); } catch { setError("Select and copy the code above."); } }}>{copied ? <Check size={16}/> : <Copy size={16}/>}{copied ? "Copied" : "Copy code"}</button>}</div>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </div>;
}

export function AccountPage() {
  const { account, signOut } = useWorkspace();
  return <div className={s.page}><PageHeader title="Your account" description={`${account.account.name} · Farm administrator`} />
    <section className={styles.accountCard}><span className={styles.eyebrow}>{account.farm.isDemo ? "BAYS RANCH DEMO" : "YOUR FARM"}</span><h2 style={{ marginTop:12 }}>{account.farm.name}</h2><div className={styles.accountActions}>{!account.farm.isDemo && <Link className={styles.secondaryButton} href="/onboarding">Manage fields</Link>}<Link className={styles.primaryButton} href="/">Open dashboard<ArrowRight size={15}/></Link><button className={styles.textButton} onClick={() => void signOut()}>Sign out</button></div></section>
    {!account.farm.isDemo && <InviteCode />}
  </div>;
}
