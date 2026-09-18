"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowDownToLine, FileText, Maximize2, Minimize2, Printer, Search, Trash2, X } from "lucide-react";
import type { LogDto } from "@/contracts/dashboard";
import {
  reportCatalog, reportKinds,
  type ReportCell, type ReportGap, type ReportKind, type ReportListResponse, type ReportResponse, type SavedReportDto, type SavedReportSummary,
} from "@/contracts/reports";
import { requestJson, useWorkspace } from "@/components/workspace/workspace-provider";
import { downloadCsv, EmptyState, PageHeader } from "@/components/workspace/workspace-ui";
import styles from "./operations.module.css";
import own from "./reports.module.css";

const utc = (iso: string) => new Date(`${iso}T12:00:00Z`);
const shortDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const longDay = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthYear = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const stamp = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short" });
const isWholeMonth = (from: string, to: string) => from.endsWith("-01") && utc(to).getUTCMonth() === utc(from).getUTCMonth() && utc(to).getUTCFullYear() === utc(from).getUTCFullYear() && new Date(utc(to).getTime() + 86_400_000).getUTCDate() === 1;
const periodName = (from: string, to: string) => isWholeMonth(from, to) ? monthYear.format(utc(from)) : `${shortDay.format(utc(from))} – ${shortDay.format(utc(to))}`;
const periodText = (from: string, to: string) => `${longDay.format(utc(from))} – ${longDay.format(utc(to))}`;

/** Which of a period's logs each report draws on, for the count shown before generating. */
const USES: Record<ReportKind, (log: LogDto) => boolean> = {
  "pesticide-use": log => ["Spraying", "Pest Control"].includes(log.activity),
  "food-safety": log => ["Spraying", "Pest Control", "Fertilizing", "Harvesting", "Irrigation"].includes(log.activity),
  "harvest-traceability": log => log.activity === "Harvesting",
  "labor-hours": () => true,
  organic: () => true,
  acreage: log => ["Planting", "Seeding"].includes(log.activity),
  nitrogen: log => ["Fertilizing", "Irrigation", "Harvesting"].includes(log.activity),
};

function Readiness({ report }: { report: SavedReportSummary }) {
  const { status } = report.readiness;
  const missing = /(\d+) required item/.exec(report.readiness.message)?.[1];
  return <span className={`${styles.badge} ${status === "ready" ? styles.green : status === "incomplete" ? styles.amber : ""}`}>
    {status === "ready" ? "Ready to file" : status === "incomplete" ? `${missing ?? "Some"} missing` : "No records"}
  </span>;
}

function Value({ cell }: { cell: ReportCell }) {
  if (cell.value === null) return <span className={own.missing}>Not recorded</span>;
  if (cell.quote) return <span className={own.quoted} title={`Read from the log: “${cell.quote}”`}>{cell.value}</span>;
  return <>{cell.value}</>;
}

function reportCsvRows(report: SavedReportDto): (string | number)[][] {
  const { document } = report;
  const text = (cell: ReportCell) => cell.value ?? "Not recorded";
  const rows: (string | number)[][] = [
    [document.form.formTitle], [document.form.authority], ["Report", report.name], ["Period", periodText(report.from, report.to)],
    ...document.header.map(field => [field.label, text(field.cell)]), [],
  ];
  for (const section of document.sections) rows.push([section.title], section.columns, ...section.rows.map(row => row.cells.map(text)), []);
  if (document.gaps.length) rows.push(["Missing before filing"], ["Item", "Detail"], ...document.gaps.map(gap => [gap.label, gap.detail]));
  return rows;
}
/** Gaps missing from the same records for the same reason read as one line. */
function groupGaps(gaps: readonly ReportGap[]): { labels: string[]; detail: string; logIds: string[] }[] {
  const groups = new Map<string, { labels: string[]; detail: string; logIds: string[] }>();
  for (const gap of gaps) {
    const key = gap.logIds.length ? `${gap.detail}|${gap.logIds.join()}` : gap.label;
    const group = groups.get(key) ?? { labels: [], detail: gap.detail, logIds: gap.logIds };
    group.labels.push(gap.label);
    groups.set(key, group);
  }
  return [...groups.values()];
}
const csvName = (name: string) => `${name.replace(/[^a-z0-9 -]/gi, "").trim().replaceAll(" ", "-").toLowerCase() || "toph-report"}.csv`;

/** A saved report as a document: full screen, print or save as PDF, or CSV. */
function ReportViewer({ summary, report, error, logs, onClose }: { summary: SavedReportSummary; report: SavedReportDto | null; error: string; logs: ReadonlyMap<string, LogDto>; onClose: () => void }) {
  const overlay = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  // `document.fullscreenEnabled` can be true where the request is still refused (embedded viewers), so we only learn on use.
  const [fullscreenBlocked, setFullscreenBlocked] = useState(false);
  const canFullscreen = typeof document !== "undefined" && document.fullscreenEnabled;
  const definition = reportCatalog[summary.kind];

  useEffect(() => {
    const element = overlay.current;
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === element);
    // Esc exits full screen first; the browser owns that, so only close once we are back in the page.
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.fullscreenElement) { event.preventDefault(); onClose(); } };
    const previousOverflow = document.body.style.overflow;
    document.addEventListener("fullscreenchange", syncFullscreen);
    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("toph-report-open");
    document.body.style.overflow = "hidden";
    element?.focus();
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreen);
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("toph-report-open");
      document.body.style.overflow = previousOverflow;
      if (document.fullscreenElement === element) void document.exitFullscreen().catch(() => {});
    };
  }, [onClose]);

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void overlay.current?.requestFullscreen().catch(() => setFullscreenBlocked(true));
  }
  const logLabel = (id: string) => { const log = logs.get(id); return log ? `${shortDay.format(utc(log.date)).replace(/, \d{4}$/, "")} · ${log.field.name} · ${log.employee.name}` : null; };
  const doc = report?.document;

  return <div ref={overlay} className={`${styles.viewerOverlay} toph-report-sheet`} role="dialog" aria-modal="true" aria-label={`${summary.name}, ${definition.name}`} tabIndex={-1}>
    <div className={styles.viewerBar}>
      <div className={styles.viewerTitle}><FileText size={16} /><strong>{summary.name}</strong><Readiness report={summary} /></div>
      <div className={styles.viewerActions}>
        {canFullscreen && <button type="button" className={styles.iconButton} onClick={toggleFullscreen} disabled={fullscreenBlocked} aria-label={fullscreen ? "Exit full screen" : "View full screen"} title={fullscreenBlocked ? "Full screen is not available in this browser" : fullscreen ? "Exit full screen" : "Full screen"}>{fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>}
        <button type="button" className={styles.iconButton} onClick={() => window.print()} disabled={!report} aria-label="Print or save as PDF" title="Print / save as PDF"><Printer size={16} /></button>
        <button type="button" className={styles.iconButton} onClick={() => report && downloadCsv(csvName(report.name), reportCsvRows(report))} disabled={!report} aria-label={`Download ${summary.name} as CSV`} title="Download CSV"><ArrowDownToLine size={16} /></button>
        <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close report" title="Close"><X size={16} /></button>
      </div>
    </div>
    <div className={styles.viewerScroll} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <article className={styles.sheet}>
        {!doc ? <p className={styles.sheetEmpty} role={error ? "alert" : "status"}>{error || "Opening report…"}</p> : <>
          <header className={styles.sheetHead}>
            <p className={styles.sheetFarm}>{doc.farm.name} · {doc.form.authority}</p>
            <h1>{doc.form.formTitle}</h1>
            <p className={own.formFor}>{doc.form.recipient} · {doc.form.cadence}</p>
            <dl className={styles.sheetMeta}>
              {doc.header.map(field => <div key={field.label}><dt>{field.label}</dt><dd><Value cell={field.cell} /></dd></div>)}
              {!doc.header.some(field => /period|month/i.test(field.label)) && <div><dt>Period</dt><dd>{periodText(doc.period.from, doc.period.to)}</dd></div>}
              <div><dt>Prepared</dt><dd>{stamp.format(new Date(doc.generatedAt))}{summary.createdBy ? ` by ${summary.createdBy}` : ""}</dd></div>
            </dl>
            <p className={styles.sheetNote}>
              Frozen when prepared: later edits to logs do not change it. Every value comes from a Toph log. {doc.detection.method === "ai"
                ? <>Underlined values were read from a log&apos;s own words by {doc.detection.model} (hover to see them); {doc.detection.logsRead} log{doc.detection.logsRead === 1 ? "" : "s"} read.</>
                : "Only values recorded on logs were used."} Nothing is estimated; blank items were not recorded.
            </p>
          </header>
          <section className={`${own.readiness} ${doc.readiness.status === "ready" ? own.ready : doc.readiness.status === "incomplete" ? own.incomplete : ""}`} aria-label="Filing readiness">
            <strong>{doc.readiness.status === "ready" ? "Ready to file" : doc.readiness.status === "incomplete" ? "Not ready to file" : "Nothing to report"}</strong>
            <span>{doc.readiness.message}</span>
            {doc.gaps.length > 0 && <ul className={own.gapList}>{groupGaps(doc.gaps).map(group => {
              const chips = group.logIds.map(logLabel).filter((label): label is string => Boolean(label));
              return <li key={group.labels.join()}><b>{group.labels.join(", ")}</b><span>{group.detail}</span>{chips.length > 0 && <span className={own.chips}>{chips.slice(0, 6).map(label => <span key={label} className={own.chip}>{label}</span>)}{chips.length > 6 && <span className={own.chip}>+{chips.length - 6} more</span>}</span>}</li>;
            })}</ul>}
          </section>
          {doc.sections.map(section => <section key={section.title} className={own.section}>
            <div className={own.sectionHead}><h2>{section.title}</h2>{section.note && <p>{section.note}</p>}</div>
            {section.rows.length
              ? <div className={styles.sheetTableScroll}><table className={styles.sheetTable}><thead><tr>{section.columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody>{section.rows.map((row, index) => <tr key={`${row.logIds.join("-")}-${index}`}>{row.cells.map((cell, cellIndex) => <td key={cellIndex}><Value cell={cell} /></td>)}</tr>)}</tbody></table></div>
              : <p className={own.sectionEmpty}>{section.emptyText}</p>}
          </section>)}
          <footer className={own.sheetFoot}>Structure follows the <a href={doc.form.sourceUrl} target="_blank" rel="noreferrer">published source</a> for this record. Check requirements with the receiving agency or certifier before filing.</footer>
        </>}
      </article>
    </div>
  </div>;
}

export function ReportsPage() {
  const { data, notify } = useWorkspace();
  const [kind, setKind] = useState<ReportKind>("pesticide-use");
  const [from, setFrom] = useState("2026-04-01");
  const [to, setTo] = useState("2026-04-30");
  const [customName, setCustomName] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reports, setReports] = useState<SavedReportSummary[] | null>(null);
  const [listError, setListError] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<{ summary: SavedReportSummary; report: SavedReportDto | null; error: string } | null>(null);
  const loaded = useRef(new Map<string, SavedReportDto>());

  const invalidRange = Boolean(from && to && to < from);
  const matching = useMemo(() => invalidRange ? [] : data.logs.filter(log => log.date >= from && log.date <= to), [data.logs, from, to, invalidRange]);
  const used = matching.filter(USES[kind]).length;
  const definition = reportCatalog[kind];
  const defaultName = from && to && !invalidRange ? `${periodName(from, to)} ${definition.name}` : definition.name;
  const name = customName ?? defaultName;
  const logsById = useMemo(() => new Map(data.logs.map(log => [log.id, log])), [data.logs]);
  const shown = (reports ?? []).filter(report => `${report.name} ${reportCatalog[report.kind]?.name ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    let live = true;
    requestJson<ReportListResponse>("/api/reports")
      .then(body => { if (live) setReports(body.data); })
      .catch(cause => { if (live) { setReports([]); setListError(cause instanceof Error ? cause.message : "Reports could not be loaded."); } });
    return () => { live = false; };
  }, []);

  const close = useCallback(() => setOpen(null), []);
  async function view(summary: SavedReportSummary) {
    const cached = loaded.current.get(summary.id);
    setOpen({ summary, report: cached ?? null, error: "" });
    if (cached) return;
    try {
      const body = await requestJson<ReportResponse>(`/api/reports/${summary.id}`);
      loaded.current.set(summary.id, body.data);
      setOpen(current => current?.summary.id === summary.id ? { ...current, report: body.data } : current);
    } catch (cause) {
      setOpen(current => current?.summary.id === summary.id ? { ...current, error: cause instanceof Error ? cause.message : "This report could not be opened." } : current);
    }
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) { setError("Give your report a name."); return; }
    if (invalidRange) { setError("End date must be on or after the start date."); return; }
    setError("");
    setBusy(true);
    try {
      const body = await requestJson<ReportResponse>("/api/reports", { method: "POST", body: JSON.stringify({ kind, name: name.trim(), from, to }) });
      loaded.current.set(body.data.id, body.data);
      setReports(current => [body.data, ...(current ?? [])]);
      setCustomName(null);
      setOpen({ summary: body.data, report: body.data, error: "" });
      notify(`“${body.data.name}” saved.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The report could not be prepared. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(summary: SavedReportSummary) {
    try {
      await requestJson(`/api/reports/${summary.id}`, { method: "DELETE" });
      loaded.current.delete(summary.id);
      setReports(current => (current ?? []).filter(item => item.id !== summary.id));
      notify(`“${summary.name}” deleted.`);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "The report could not be deleted.");
    }
  }

  async function download(summary: SavedReportSummary) {
    try {
      const report = loaded.current.get(summary.id) ?? (await requestJson<ReportResponse>(`/api/reports/${summary.id}`)).data;
      loaded.current.set(summary.id, report);
      downloadCsv(csvName(report.name), reportCsvRows(report));
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "The CSV could not be prepared.");
    }
  }

  return <div className={styles.page}>
    <PageHeader title="Reports" />
    <div className={styles.reportLayout}>
      <section className={styles.panel}><div className={styles.toolbar}><h2><FileText size={17} /> Create report</h2><span className={styles.badge}>From your logs</span></div>
        <form className={`${styles.form} ${styles.padded}`} onSubmit={generate}>
          <fieldset className={styles.reportTypes}><legend>Report type</legend>{reportKinds.map(value => <label key={value} className={`${styles.reportType} ${kind === value ? styles.selectedType : ""}`}><input type="radio" name="report-kind" value={value} checked={kind === value} onChange={() => setKind(value)} /><span><strong>{reportCatalog[value].name}</strong><small>{reportCatalog[value].description}</small></span></label>)}</fieldset>
          <label>Report name<input value={name} onChange={event => setCustomName(event.target.value)} required maxLength={160} placeholder="Name your report" /></label>
          <div className={styles.formGrid}><label>From<input type="date" value={from} onChange={event => setFrom(event.target.value)} required /></label><label>To<input type="date" value={to} min={from} onChange={event => setTo(event.target.value)} required /></label></div>
          {(error || invalidRange) && <p className={styles.error} role="alert">{invalidRange ? "End date must be on or after the start date." : error}</p>}
          <div className={styles.reportPreview}><span><strong>{matching.length}</strong> logs in this period</span><span><strong>{used}</strong> used by this report</span></div>
          <button type="submit" className={styles.primaryButton} disabled={busy || invalidRange}><FileText size={15} />{busy ? "Reading your logs…" : "Generate report"}</button>
          <p className={styles.help}>{definition.formTitle} · {definition.authority}. Toph fills each item from what your logs state and lists anything missing. Nothing is guessed.</p>
        </form>
      </section>
      <section className={styles.panel}><div className={styles.toolbar}><h2>Saved reports <span>({reports?.length ?? 0})</span></h2></div>
        <div className={styles.savedSearch}><label className={styles.search}><Search size={15} /><input type="search" aria-label="Search saved reports" placeholder="Find a report" value={query} onChange={event => setQuery(event.target.value)} /></label></div>
        {reports === null ? <p className={own.listStatus} role="status">Loading reports…</p>
          : listError ? <p className={`${own.listStatus} ${styles.error}`} role="alert">{listError}</p>
          : shown.length ? <div className={styles.reportList}>{shown.map(report => <article className={styles.savedReport} key={report.id}>
            <button type="button" className={styles.reportOpen} onClick={() => void view(report)} aria-label={`Open ${report.name}`}><span className={styles.fileIcon}><FileText size={19} strokeWidth={1.4} /></span><span className={styles.reportInfo}><strong>{report.name}</strong><span>{reportCatalog[report.kind]?.name ?? report.kind} · <Readiness report={report} /></span><small>{periodText(report.from, report.to)}</small></span></button>
            <div className={styles.reportActions}><button type="button" className={styles.iconButton} aria-label={`Download ${report.name} as CSV`} title="Download CSV" onClick={() => void download(report)}><ArrowDownToLine size={16} /></button><button type="button" className={styles.iconButton} aria-label={`Delete ${report.name}`} title="Delete report" onClick={() => void remove(report)}><Trash2 size={16} /></button></div>
          </article>)}</div>
          : <EmptyState title={query ? "No reports found" : "No reports yet"} description={query ? "Try another report name." : "Generate a report to keep a frozen copy here."} />}
        <div className={styles.panelFoot}>Reports are frozen when prepared. Generate a new one to include later changes.</div>
      </section>
    </div>
    {open && <ReportViewer summary={open.summary} report={open.report} error={open.error} logs={logsById} onClose={close} />}
  </div>;
}
