"use client";

import { LoaderCircle, RotateCw, Sparkles, X } from "lucide-react";
import type { AskFarmResult } from "@/contracts/ask";
import { formatDate } from "@/lib/format";
import type { EmployeeLog } from "./types";
import styles from "./ask-panel.module.css";

export type AskState =
  | { status: "loading"; question: string }
  | { status: "done"; question: string; result: AskFarmResult }
  | { status: "error"; question: string; message: string };

/** The answer to a farm question, with its supporting logs as links into the table below. */
export function AskPanel({ state, logs, citedOnly, onOpenLog, onToggleCitedOnly, onRetry, onClose }: {
  state: AskState; logs: EmployeeLog[]; citedOnly: boolean;
  onOpenLog: (id: string) => void; onToggleCitedOnly: () => void; onRetry: () => void; onClose: () => void;
}) {
  const cited = state.status === "done" ? state.result.citedLogIds.flatMap(id => logs.filter(log => log.id === id)) : [];
  return <section className={styles.panel} aria-label="Answer from Toph" aria-busy={state.status === "loading"}>
    <div className={styles.heading}>
      <span className={styles.badge}><Sparkles size={14} />Ask Toph</span>
      <p className={styles.question}>{state.question}</p>
      <button type="button" className={styles.close} aria-label={state.status === "loading" ? "Cancel question" : "Close answer"} onClick={onClose}><X size={16} /></button>
    </div>
    <div aria-live="polite">
      {state.status === "loading" && <p className={styles.loading}><LoaderCircle size={16} className={styles.spinner} />Reading your farm’s activity logs…</p>}
      {state.status === "error" && <div className={styles.error}><p>{state.message}</p><button type="button" onClick={onRetry}><RotateCw size={14} />Try again</button></div>}
      {state.status === "done" && <>
        <p className={styles.answer}>{state.result.answer}</p>
        {cited.length > 0 && <div className={styles.sources}>
          <div className={styles.sourcesHeading}>
            <span>Based on {cited.length} {cited.length === 1 ? "log" : "logs"}</span>
            <button type="button" className={styles.filterToggle} aria-pressed={citedOnly} onClick={onToggleCitedOnly}>{citedOnly ? "Show all logs" : "Show only these in the table"}</button>
          </div>
          <ul>{cited.map(log => <li key={log.id}><button type="button" onClick={() => onOpenLog(log.id)}>
            <strong>{log.employee.name}</strong><span>{log.activity} · {log.field.name} · {formatDate(log.date)}</span>
          </button></li>)}</ul>
        </div>}
        {state.result.truncated && <p className={styles.note}>Only the {state.result.consideredLogs} most recent logs were considered.</p>}
        <p className={styles.note}>AI answers can be wrong. Open the cited logs to check.</p>
      </>}
    </div>
  </section>;
}
