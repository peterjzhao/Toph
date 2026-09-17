"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import type { AuthResponse } from "@/contracts/accounts";
import { accountDestination, accountRequest, currentAccount } from "@/lib/account-client";
import styles from "./accounts.module.css";

export function AuthPage({ signup = false }: { signup?: boolean }) {
  const [name, setName] = useState("");
  const [farmName, setFarmName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [worker, setWorker] = useState(false);
  useEffect(() => {
    let alive = true;
    void currentAccount().then(session => {
      if (!alive) return;
      if (session.account.role === "worker") setWorker(true);
      else window.location.replace(accountDestination(session));
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await accountRequest<AuthResponse>(signup ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST", body: JSON.stringify(signup ? { name, farmName, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } : { name }),
      });
      if (response.data.account.role === "worker") { setWorker(true); return; }
      window.location.assign(accountDestination(response.data));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "We couldn’t open your account."); }
    finally { setBusy(false); }
  }
  return <main className={styles.authPage}>
    <section className={styles.intro}>
      <Link href="/login" className={styles.brand}>toph</Link>
    </section>
    <section className={styles.authFormWrap}><div className={styles.authCard}>
      <h2>{signup ? "Sign up" : "Log in"}</h2>
      {worker ? <div className={styles.workerNotice}><h3>Use the mobile app for your worker account.</h3><button className={styles.secondaryButton} disabled={busy} onClick={async () => {
        setBusy(true); try { await accountRequest("/api/auth/logout", { method: "POST", body: "{}" }); setWorker(false); setName(""); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "Could not sign out."); } finally { setBusy(false); }
      }}>Sign out</button></div> : <form className={styles.form} onSubmit={submit}>
        <label>Name<input autoFocus required autoComplete="username" maxLength={80} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
        {signup && <label>Farm name<input required maxLength={120} autoComplete="organization" value={farmName} disabled={busy} onChange={event => setFarmName(event.target.value)} /></label>}
        <button type="submit" className={styles.primaryButton} disabled={busy}>{busy ? "One moment…" : signup ? "Create farm" : "Log in"}{!busy && <ArrowRight size={17} />}</button>
      </form>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {!worker && <p className={styles.switchLink}><Link href={signup ? "/login" : "/signup"}>{signup ? "Log in" : "Create an account"}</Link></p>}

    </div></section>
  </main>;
}
