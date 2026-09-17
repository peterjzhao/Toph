"use client";
import { useEffect, useRef, type ReactNode, type ButtonHTMLAttributes } from "react";
import { X } from "lucide-react";
import s from "./workspace.module.css";
export function PageHeader({ title, description, children }: { title: string; description?: string; children?: ReactNode }) { return <header className={s.pageHeader}><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{children && <div className={s.headerActions}>{children}</div>}</header>; }
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) { return <section className={`${s.panel} ${className}`}>{children}</section>; }
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "amber" }) { return <span className={`${s.badge} ${tone === "green" ? s.greenBadge : tone === "amber" ? s.amberBadge : ""}`}>{children}</span>; }
export function Button({ children, secondary = false, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { secondary?: boolean }) { return <button {...props} className={`${secondary ? s.secondaryButton : s.primaryButton} ${props.className ?? ""}`}>{children}</button>; }
export function EmptyState({ title, description, children }: { title: string; description?: string; children?: ReactNode }) { return <div className={s.empty}><h3>{title}</h3>{description && <p>{description}</p>}{children}</div>; }
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); dialog?.querySelector<HTMLElement>("[data-autofocus], input, select, textarea")?.focus(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className={`${s.dialog} ${wide ? s.wideDialog : ""}`} aria-label={title} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div className={s.dialogContent}><div className={s.dialogHeader}><h2>{title}</h2><button type="button" onClick={onClose} aria-label="Close dialog" className={s.iconButton}><X size={18}/></button></div>{children}</div></dialog>;
}
export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows.map(row => row.map(cell => { let text = String(cell); if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; }).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
