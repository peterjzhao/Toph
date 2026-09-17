"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ArrowRight, ImagePlus, Plus, Trash2, Sparkles, LoaderCircle } from "lucide-react";
import type { AccountSession, FarmSetupResponse } from "@/contracts/accounts";
import { accountRequest, currentAccount, AccountRequestError } from "@/lib/account-client";
import { FIELD_LABELS, nextFieldLabel, prepareFarmImage, validFieldBoundary, type DraftField, type FieldPoint } from "@/lib/farm-fields";
import { FilterSelect } from "@/components/dashboard/filter-select";
import styles from "./accounts.module.css";

type SetupImage = { url: string; width: number; height: number; dataUrl?: string };

export function FarmSetupPage() {
  const [session, setSession] = useState<AccountSession | null>(null);
  const [image, setImage] = useState<SetupImage | null>(null);
  const [fields, setFields] = useState<DraftField[]>([]);
  const [candidates, setCandidates] = useState<FieldPoint[][]>([]);
  const [pendingBoundary, setPendingBoundary] = useState<FieldPoint[] | null>(null);
  const [pendingLabel, setPendingLabel] = useState("A");
  const [selected, setSelected] = useState("");
  const [detected, setDetected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [detecting, setDetecting] = useState(false);
  const detection = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const imageElement = useRef<HTMLImageElement>(null);
  const detectAfterUpload = useRef(false);
  useEffect(() => () => detection.current?.abort(), []);
  useEffect(() => {
    let alive = true;
    void currentAccount().then(async account => {
      if (account.account.role !== "admin") { window.location.replace("/login?worker=1"); return; }
      if (account.farm.isSample) { window.location.replace("/"); return; }
      const setup = await accountRequest<FarmSetupResponse>("/api/farm/setup");
      if (!alive) return;
      setSession(account); setImage(setup.data.image); setFields(setup.data.fields); setSelected(setup.data.fields[0]?.label ?? "");
    }).catch(cause => {
      if (cause instanceof AccountRequestError && cause.status === 401) window.location.replace("/login");
      else if (alive) setError(cause instanceof Error ? cause.message : "We couldn’t load your farm setup.");
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true); setError("");
    try {
      const prepared = await prepareFarmImage(file);
      detectAfterUpload.current = true;
      setImage({ ...prepared, url: prepared.dataUrl }); setFields([]); setCandidates([]); setPendingBoundary(null); setSelected("");
      setProgress(""); setDetected(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "We couldn’t open the image."); }
    finally { setBusy(false); event.target.value = ""; }
  }
  function addField(boundary: FieldPoint[], chosenLabel?: string) {
    const label = chosenLabel ?? nextFieldLabel(fields);
    if (!label) { setError("You can add up to 26 fields, A–Z."); return; }
    if (!validFieldBoundary(boundary)) { setError("This field boundary is invalid."); return; }
    if (fields.some(field => field.label === label)) { setError(`Field ${label} is already assigned. Choose another letter.`); return; }
    setFields(previous => [...previous, { label, boundary }]); setSelected(label); setError("");
  }
  function chooseRegion(boundary: FieldPoint[]) {
    if (busy || fields.length >= 26) return;
    setPendingBoundary(boundary); setPendingLabel(nextFieldLabel(fields) ?? "A"); setSelected("");
  }
  async function detect() {
    if (!imageElement.current || busy || fields.length) return;
    const controller = new AbortController(); detection.current = controller;
    setBusy(true); setDetecting(true); setDetected(false); setProgress(""); setError("");
    try {
      const { detectFields } = await import("@/lib/segmentation/detect-fields");
      const candidates = await detectFields(imageElement.current, { signal: controller.signal, onProgress: () => {} });
      const valid = candidates.filter(validFieldBoundary);
      setCandidates(valid); setPendingBoundary(null); setDetected(true);
      setProgress(`${valid.length} fields detected`);
    } catch (cause) {
      if (controller.signal.aborted) setProgress("");
      else { setError(cause instanceof Error ? cause.message : "Detection could not run. Please try again."); setProgress(""); }
    } finally { setBusy(false); setDetecting(false); detection.current = null; }
  }
  async function save() {
    if (busy || !image || !fields.length) return;
    if (fields.some(field => !validFieldBoundary(field.boundary))) { setError("Each field needs a valid boundary inside the image."); return; }
    setBusy(true); setError("");
    try {
      await accountRequest<FarmSetupResponse>("/api/farm/setup", { method: "POST", body: JSON.stringify({ ...(image.dataUrl ? { image: { dataUrl: image.dataUrl, width: image.width, height: image.height } } : {}), fields }) });
      window.location.assign("/account?created=1");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Your fields couldn’t be saved. Please try again."); setBusy(false); setProgress(""); }
  }
  if (loading) return <main className={styles.loading} role="status">Loading your farm…</main>;
  return <main className={styles.setupPage}>
    <header className={styles.setupHeader}><Link className={styles.brand} href="/login">toph</Link><button className={styles.textButton} disabled={busy} onClick={async () => {
      try { await accountRequest("/api/auth/logout", { method: "POST", body: "{}" }); window.location.assign("/login"); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "Could not sign out."); }
    }}>Sign out</button></header>
    <div className={styles.setupTitle}><h1>Field Setup</h1></div>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={event => void upload(event)} />
    <div className={`${styles.setupGrid} ${!detected && !fields.length ? styles.setupGridSingle : ""}`}>
      <section className={styles.mapCard} aria-label="Farm image and field boundaries">
        {image ? <div className={styles.editor} style={{ aspectRatio: `${image.width} / ${image.height}` }}>
          <img ref={imageElement} onLoad={() => { if (detectAfterUpload.current) { detectAfterUpload.current = false; void detect(); } }} src={image.url} width={image.width} height={image.height} alt={`Aerial image of ${session?.farm.name ?? "your farm"}`} draggable={false} style={{ maxHeight: "none" }} />
          <svg viewBox="0 0 1 1" preserveAspectRatio="none"  aria-label="Field boundary editor">
            {candidates.map((boundary, index) => <polygon key={`candidate-${index}`} className={`${styles.candidatePolygon} ${pendingBoundary === boundary ? styles.pendingPolygon : ""}`} points={boundary.map(point => `${point.x},${point.y}`).join(" ")} role="button" tabIndex={0} aria-label={`Label detected field ${index + 1}`} onClick={() => chooseRegion(boundary)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); chooseRegion(boundary); } }} />)}
            {fields.map(field => <g key={field.label}><polygon points={field.boundary.map(point => `${point.x},${point.y}`).join(" ")} className={selected === field.label ? styles.selectedPolygon : undefined} role="button" tabIndex={0} aria-label={`Select Field ${field.label}`} aria-pressed={selected === field.label} onClick={() => { setSelected(field.label); setPendingBoundary(null); }} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(field.label); setPendingBoundary(null); } }} /><text x={field.boundary.reduce((sum, point) => sum + point.x, 0) / field.boundary.length} y={field.boundary.reduce((sum, point) => sum + point.y, 0) / field.boundary.length} dominantBaseline="middle" textAnchor="middle">FIELD {field.label}</text></g>)}
          </svg>
        </div> : <div className={styles.upload}><ImagePlus size={38} strokeWidth={1.2} /><p>Choose an aerial satellite image with your farm, with your fields in view.</p><button className={styles.primaryButton} disabled={busy || !session} onClick={() => input.current?.click()}><Plus size={17} />Upload farm image</button></div>}
        {image && <div className={styles.mapToolbar}>
          {detecting ? <><LoaderCircle className={styles.spinner} size={18} role="status" aria-label="Detecting fields" /><button className={styles.textButton} onClick={() => detection.current?.abort()}>Cancel</button></> : <>
            {!fields.length && <button className={styles.textButton} disabled={busy} onClick={() => void detect()}><Sparkles size={16} />Detect fields</button>}
            {!fields.some(field => field.id) && <button className={styles.textButton} disabled={busy} onClick={() => input.current?.click()}>Replace image</button>}
          </>}
        </div>}
        {progress && <p className={styles.progress} role="status">{progress}</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </section>
      {(detected || fields.length > 0) && <aside className={styles.fieldCard} aria-label="Field assignments">
        {pendingBoundary && <div className={styles.assignField}><FilterSelect label="Field letter" value={pendingLabel} options={FIELD_LABELS.filter(label => !fields.some(field => field.label === label)).map(label => ({ value: label, label: `Field ${label}` }))} onChange={setPendingLabel} /><button className={styles.primaryButton} onClick={() => { addField(pendingBoundary, pendingLabel); setCandidates(previous => previous.filter(boundary => boundary !== pendingBoundary)); setPendingBoundary(null); }}>Assign Field {pendingLabel}</button><button className={styles.textButton} onClick={() => setPendingBoundary(null)}>Cancel</button></div>}
        <div className={styles.fieldRows}>{fields.map(field => <div className={`${styles.fieldRow} ${selected === field.label ? styles.selectedField : ""}`} key={field.id ?? field.label}>
          <button className={styles.fieldNumber} aria-label={`Select Field ${field.label}`} onClick={() => setSelected(field.label)}>{field.label}</button>
          <FilterSelect label={`Field ${field.label}`} value={field.label} disabled={busy} options={FIELD_LABELS.filter(label => label === field.label || !fields.some(item => item.label === label)).map(label => ({ value: label, label: `Field ${label}` }))} onChange={label => { setFields(previous => previous.map(item => item === field ? { ...item, label } : item)); setSelected(label); }} /><button aria-label={`Remove Field ${field.label}`} disabled={busy || Boolean(field.id)} title={field.id ? "Saved fields are preserved for recorded work" : "Remove field"} onClick={() => { setFields(previous => previous.filter(item => item !== field)); if (selected === field.label) setSelected(""); }}><Trash2 size={15} /></button>
        </div>)}</div>
        <button className={styles.primaryButton} disabled={busy || !image || !fields.length || Boolean(pendingBoundary)} onClick={() => void save()}>{busy ? "Please wait…" : "Confirm fields"}<ArrowRight size={16} /></button>
        {session?.farm.setupComplete && <Link className={styles.textButton} href="/">Back to dashboard</Link>}
      </aside>}
    </div>
  </main>;
}
