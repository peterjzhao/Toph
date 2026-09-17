"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check } from "lucide-react";
import { dateRange, dateFilterLabel, rangeDescription, validDateRange, type DateFilter, type DatePreset } from "./date-range";
import styles from "./filters.module.css";

const presets: DatePreset[] = ["today", "this-week", "this-month", "last-month", "all"];

export function DateFilterPanel({ value, today, timezone, historyMonth, onChange }: {
  value: DateFilter; today: string; timezone: string; historyMonth?: string; onChange: (value: DateFilter) => void;
}) {
  const initial = dateRange(value, today) ?? dateRange({ kind: "this-month" }, today)!;
  const [custom, setCustom] = useState(value.kind === "custom");
  const [from, setFrom] = useState(initial.from); const [to, setTo] = useState(initial.to);
  const [attempted, setAttempted] = useState(false);
  const customForm = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!custom) return;
    const frame = requestAnimationFrame(() => customForm.current?.querySelector("input")?.focus());
    return () => cancelAnimationFrame(frame);
  }, [custom]);
  const invalid = !validDateRange(from, to);
  const reversed = !!from && !!to && from > to;
  return <>
    <div className={styles.panelHeading}><CalendarDays size={16} aria-hidden/><h3>Date range</h3></div>
    <p className={styles.dateContext}>Today is {rangeDescription({ from: today, to: today })}<br/>{timezone.replaceAll("_", " ")} · Weeks start Monday</p>
    <div className={styles.presetList} role="group" aria-label="Date presets">
      {presets.map(kind => <button key={kind} type="button" aria-pressed={value.kind === kind && !custom} className={styles.preset} onClick={() => onChange({ kind })}>
        <span>{dateFilterLabel({ kind })}<small>{rangeDescription(dateRange({ kind }, today))}</small></span>{value.kind === kind && !custom && <Check size={16} aria-hidden/>}
      </button>)}
      {historyMonth && <button type="button" aria-pressed={value.kind === "month" && value.month === historyMonth && !custom} className={styles.preset} onClick={() => onChange({ kind: "month", month: historyMonth })}>
        <span>{dateFilterLabel({ kind: "month", month: historyMonth })}<small>Latest month with recorded activity</small></span>{value.kind === "month" && !custom && <Check size={16} aria-hidden/>}
      </button>}
      <button type="button" className={styles.preset} aria-expanded={custom} aria-controls="custom-log-range" onClick={() => setCustom(!custom)}><span>Custom Range<small>Choose a start and end date</small></span>{custom && <Check size={16} aria-hidden/>}</button>
    </div>
    {custom && <form ref={customForm} id="custom-log-range" className={styles.customRange} onSubmit={event => { event.preventDefault(); setAttempted(true); if (!invalid) onChange({ kind: "custom", from, to }); }}>
      <div className={styles.dateInputs}><label>From<input type="date" required aria-label="Start date" value={from} onChange={event => setFrom(event.target.value)} aria-invalid={reversed || (attempted && invalid)}/></label><label>To<input type="date" required aria-label="End date" value={to} onChange={event => setTo(event.target.value)} aria-invalid={reversed || (attempted && invalid)}/></label></div>
      {(reversed || (attempted && invalid)) && <p role="alert" className={styles.error}>Choose valid dates with the end on or after the start.</p>}
      <button type="submit" className={styles.applyButton} disabled={invalid}>Apply range</button>
    </form>}
  </>;
}
