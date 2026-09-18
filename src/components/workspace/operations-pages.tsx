"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, ClipboardCheck, Clock3, FileText, List, Plus, Search, ShieldCheck, Trash2 } from "lucide-react";
import type { Review, ScheduleItem } from "@/contracts/workspace";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { Modal, PageHeader } from "@/components/workspace/workspace-ui";
import styles from "./operations.module.css";

const dateLabel = (value: string, short = false, includeYear = !short) => new Intl.DateTimeFormat("en-US", { month: short ? "short" : "long", day: "numeric", year: includeYear ? "numeric" : undefined, timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));

function Status({ value }: { value: string }) {
  return <span className={`${styles.badge} ${value === "Approved" || value === "Completed" ? styles.green : value === "Flagged" ? styles.amber : ""}`}>{value === "Approved" || value === "Completed" ? <Check size={12} /> : null}{value}</span>;
}

function Metric({ label, value, detail, icon }: { label: string; value: string | number; detail: string; icon: ReactNode }) {
  return <div className={styles.metric}><div className={styles.metricLabel}>{icon}{label}</div><div className={styles.metricNumber}>{value}</div><p>{detail}</p></div>;
}

function Empty({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return <div className={styles.empty}><FileText size={25} strokeWidth={1.2} /><h3>{title}</h3><p>{text}</p>{children}</div>;
}

export function AuditPage() {
  const { data, workspace, update, saving, notify } = useWorkspace();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All statuses");
  const [selected, setSelected] = useState<{ logId: string; status: Review["status"]; note: string } | null>(null);
  const [reviewError, setReviewError] = useState("");
  const reviewMap = useMemo(() => new Map(workspace.reviews.map((review) => [review.logId, review])), [workspace.reviews]);
  const counts = data.logs.reduce((result, log) => { result[reviewMap.get(log.id)?.status ?? "Pending"]++; return result; }, { Pending: 0, Approved: 0, Flagged: 0 });
  const logs = data.logs.filter((log) => (status === "All statuses" || (reviewMap.get(log.id)?.status ?? "Pending") === status) && `${log.employee.name} ${log.activity} ${log.field.name}`.toLowerCase().includes(query.toLowerCase().trim()));
  const selectedLog = data.logs.find((log) => log.id === selected?.logId);

  async function saveReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    if (selected.status === "Flagged" && !selected.note.trim()) { setReviewError("Add a short note explaining what needs follow-up."); return; }
    setReviewError("");
    const review: Review = { ...selected, note: selected.note.trim(), updatedAt: new Date().toISOString() };
    const success = await update("reviews", (previous) => [...previous.filter((item) => item.logId !== review.logId), review]);
    if (success) { setSelected(null); notify(`Review saved as ${review.status.toLowerCase()}.`); }
    else setReviewError("The review could not be saved. Your changes are still here; please try again.");
  }

  return <div className={styles.page}>
    <PageHeader title="Audit Manager" />
    <div className={styles.metrics}>
      <Metric label="Awaiting review" value={counts.Pending} detail="Logs ready for your attention" icon={<ClipboardCheck size={17} />} />
      <Metric label="Approved logs" value={counts.Approved} detail="Reviewed and signed off" icon={<ShieldCheck size={17} />} />
      <Metric label="Flagged logs" value={counts.Flagged} detail="Follow up with your team" icon={<FileText size={17} />} />
    </div>
    <section className={styles.panel} aria-label="Activity reviews">
      <div className={styles.toolbar}><h2>Activity reviews <span>({logs.length})</span></h2><div className={styles.controls}>
        <label className={styles.search}><Search size={15} /><input type="search" aria-label="Search activity reviews" placeholder="Search employee or activity" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <select aria-label="Filter reviews by status" value={status} onChange={(event) => setStatus(event.target.value)}>{["All statuses", "Pending", "Approved", "Flagged"].map((value) => <option key={value}>{value}</option>)}</select>
      </div></div>
      {logs.length ? <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>Employee</th><th>Activity</th><th>Date</th><th>Field</th><th>Status</th><th><span className={styles.srOnly}>Actions</span></th></tr></thead><tbody>
        {logs.map((log) => { const review = reviewMap.get(log.id); return <tr key={log.id}><td className={styles.name}>{log.employee.name}</td><td>{log.activity}</td><td>{dateLabel(log.date, true)}</td><td>{log.field.name}</td><td><Status value={review?.status ?? "Pending"} /></td><td className={styles.actions}><button className={styles.button} onClick={() => { setReviewError(""); setSelected({ logId: log.id, status: review?.status ?? "Pending", note: review?.note ?? "" }); }} aria-label={`Review ${log.employee.name}'s ${log.activity.toLowerCase()} log`}>Review</button></td></tr>; })}
      </tbody></table></div> : <Empty title="No matching reviews" text="Try a different employee, activity, or review status."><button className={styles.button} onClick={() => { setQuery(""); setStatus("All statuses"); }}>Clear filters</button></Empty>}
      <div className={styles.panelFoot}>Review decisions apply to the original activity log and remain available to your team.</div>
    </section>
    {selected && selectedLog && <Modal title="Review activity" onClose={() => setSelected(null)}>
      <form className={styles.form} onSubmit={saveReview}>
        <div className={styles.reviewHeading}><div><strong>{selectedLog.employee.name}</strong><p>{selectedLog.activity} · {selectedLog.field.name} · {dateLabel(selectedLog.date, true)}</p></div><Status value={selected.status} /></div>
        <div className={styles.summary}><h3>Log summary</h3><p>{selectedLog.summary}</p><Link href={`/activity-logs?log=${selectedLog.id}`} className={styles.textLink}>Open complete activity log <span aria-hidden>↗</span></Link></div>
        <label>Review status<select value={selected.status} onChange={(event) => setSelected({ ...selected, status: event.target.value as Review["status"] })}><option>Pending</option><option>Approved</option><option>Flagged</option></select></label>
        <label>Review notes <span className={styles.optional}>{selected.status === "Flagged" ? "Required for flagged activity" : "Optional"}</span><textarea rows={4} value={selected.note} onChange={(event) => setSelected({ ...selected, note: event.target.value })} placeholder="Add context for your team…" maxLength={2000} required={selected.status === "Flagged"} /></label>
        {reviewError && <p className={styles.error} role="alert">{reviewError}</p>}
        <div className={styles.formActions}><button type="button" className={styles.button} onClick={() => setSelected(null)}>Cancel</button><button type="submit" className={styles.primaryButton} disabled={saving}>{saving ? "Saving…" : "Save review"}</button></div>
      </form>
    </Modal>}
  </div>;
}

const pad = (value: number) => String(value).padStart(2, "0");
const dayKey = (date: Date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const timeLabel = (value: string) => { const [hour, minute] = value.split(":").map(Number); return `${hour % 12 || 12}:${pad(minute)} ${hour >= 12 ? "PM" : "AM"}`; };

export function SchedulePage() {
  const { data, workspace, update, saving, notify } = useWorkspace();
  const [month, setMonth] = useState({ year: 2026, month: 3 });
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [draft, setDraft] = useState<ScheduleItem | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const monthStart = new Date(Date.UTC(month.year, month.month, 1));
  const monthEnd = new Date(Date.UTC(month.year, month.month + 1, 0));
  const calendarStart = new Date(Date.UTC(month.year, month.month, 1 - monthStart.getUTCDay()));
  const numberOfDays = Math.ceil((monthStart.getUTCDay() + monthEnd.getUTCDate()) / 7) * 7;
  const days = Array.from({ length: numberOfDays }, (_, index) => new Date(calendarStart.getTime() + index * 86_400_000));
  const filtered = workspace.schedule.filter((item) => !employeeFilter || item.employeeId === employeeFilter);
  const monthItems = filtered.filter((item) => item.date >= dayKey(monthStart) && item.date <= dayKey(monthEnd)).sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
  const employeeName = (id: string) => workspace.employees.find((employee) => employee.id === id)?.name ?? "Unassigned employee";
  const fieldName = (id: string) => data.filterOptions.fields.find((field) => field.id === id)?.name ?? "Unknown field";
  const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(monthStart);

  function changeMonth(offset: number) {
    const next = new Date(Date.UTC(month.year, month.month + offset, 1));
    setMonth({ year: next.getUTCFullYear(), month: next.getUTCMonth() });
  }

  function openAssignment(item?: ScheduleItem, date?: string) {
    setEditing(Boolean(item)); setConfirmDelete(false); setError("");
    setDraft(item ? { ...item } : { id: crypto.randomUUID(), title: "", employeeId: workspace.employees.find((employee) => employee.status === "Active")?.id ?? "", fieldId: data.filterOptions.fields[0]?.id ?? "", date: date ?? dayKey(monthStart), startTime: "07:00", endTime: "10:00", notes: "", status: "Scheduled" });
  }

  async function saveAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    if (!draft.title.trim()) { setError("Enter a title for this assignment."); return; }
    if (draft.endTime <= draft.startTime) { setError("End time must be later than start time."); return; }
    if (!draft.employeeId || !draft.fieldId) { setError("Choose an employee and a field."); return; }
    const assignment = { ...draft, title: draft.title.trim(), notes: draft.notes.trim() };
    setError("");
    if (await update("schedule", (previous) => [...previous.filter((item) => item.id !== assignment.id), assignment])) {
      const [year, calendarMonth] = assignment.date.split("-").map(Number);
      setMonth({ year, month: calendarMonth - 1 });
      if (employeeFilter && employeeFilter !== assignment.employeeId) setEmployeeFilter("");
      setDraft(null);
      notify(editing ? "Assignment updated." : "Assignment added to the schedule.");
    }
    else setError("The assignment could not be saved. Your changes are still here; please try again.");
  }

  async function removeAssignment() {
    if (!draft) return;
    if (await update("schedule", (previous) => previous.filter((item) => item.id !== draft.id))) { setDraft(null); notify("Assignment deleted."); }
    else setError("The assignment could not be deleted. Please try again.");
  }

  async function toggleCompleted(item: ScheduleItem) {
    const status: ScheduleItem["status"] = item.status === "Scheduled" ? "Completed" : "Scheduled";
    if (await update("schedule", (previous) => previous.map((entry) => entry.id === item.id ? { ...entry, status } : entry))) notify(status === "Completed" ? "Assignment marked complete." : "Assignment reopened.");
  }

  return <div className={styles.page}>
    <PageHeader title="Schedule"><button className={styles.primaryButton} onClick={() => openAssignment()}><Plus size={16} />New assignment</button></PageHeader>
    <div className={styles.metrics}>
      <Metric label="This month's assignments" value={monthItems.length} detail={monthLabel} icon={<CalendarDays size={17} />} />
      <Metric label="Scheduled" value={monthItems.filter((item) => item.status === "Scheduled").length} detail="Work still to be completed" icon={<Clock3 size={17} />} />
      <Metric label="Completed" value={monthItems.filter((item) => item.status === "Completed").length} detail="Finished assignments this month" icon={<Check size={17} />} />
    </div>
    <section className={styles.panel} aria-label="Farm work schedule">
      <div className={styles.toolbar}><div className={styles.monthControls}><h2>{monthLabel}</h2><button className={styles.iconButton} aria-label="Previous month" onClick={() => changeMonth(-1)}><ChevronLeft size={17} /></button><button className={styles.iconButton} aria-label="Next month" onClick={() => changeMonth(1)}><ChevronRight size={17} /></button><button className={styles.button} onClick={() => setMonth({ year: 2026, month: 3 })}>April 2026</button></div>
        <div className={styles.controls}><select aria-label="Filter schedule by employee" value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}><option value="">All employees</option>{workspace.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select><div className={styles.segmented} aria-label="Schedule view"><button aria-pressed={view === "calendar"} onClick={() => setView("calendar")}><CalendarDays size={15} />Calendar</button><button aria-pressed={view === "list"} onClick={() => setView("list")}><List size={15} />List</button></div></div>
      </div>
      {view === "calendar" ? <div className={styles.calendarScroll}><div className={styles.calendar}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div className={styles.weekday} key={day}>{day}</div>)}
        {days.map((date) => { const key = dayKey(date); const items = filtered.filter((item) => item.date === key).sort((a, b) => a.startTime.localeCompare(b.startTime)); return <div key={key} className={`${styles.day} ${date.getUTCMonth() !== month.month ? styles.otherMonth : ""}`}>
          <button className={styles.dayNumber} title={`Add assignment on ${dateLabel(key)}`} aria-label={`Add assignment on ${dateLabel(key)}`} onClick={() => openAssignment(undefined, key)}>{date.getUTCDate()}<Plus size={11} /></button>
          {items.map((item) => <button className={`${styles.calendarEvent} ${item.status === "Completed" ? styles.completedEvent : ""}`} key={item.id} onClick={() => openAssignment(item)} aria-label={`Edit ${item.title}, ${employeeName(item.employeeId)}, ${dateLabel(item.date)}`}><span>{timeLabel(item.startTime)}{item.status === "Completed" && <Check size={11} />}</span><strong>{item.title}</strong><small>{employeeName(item.employeeId).split(" ")[0]} · {fieldName(item.fieldId)}</small></button>)}
        </div>; })}
      </div></div> : monthItems.length ? <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>Assignment</th><th>Employee</th><th>Date / time</th><th>Field</th><th>Status</th><th><span className={styles.srOnly}>Actions</span></th></tr></thead><tbody>
        {monthItems.map((item) => <tr key={item.id}><td className={styles.name}>{item.title}</td><td>{employeeName(item.employeeId)}</td><td><span>{dateLabel(item.date, true)}</span><small className={styles.cellSub}>{timeLabel(item.startTime)} – {timeLabel(item.endTime)}</small></td><td>{fieldName(item.fieldId)}</td><td><Status value={item.status} /></td><td><div className={styles.rowButtons}><button className={styles.button} onClick={() => openAssignment(item)} aria-label={`Edit ${item.title}`}>Edit</button><button className={styles.iconButton} disabled={saving} aria-label={`${item.status === "Completed" ? "Reopen" : "Complete"} ${item.title}`} title={item.status === "Completed" ? "Reopen assignment" : "Mark complete"} onClick={() => void toggleCompleted(item)}><Check size={16} /></button></div></td></tr>)}
      </tbody></table></div> : <Empty title="A clear schedule" text="No assignments match this month and employee."><button className={styles.button} onClick={() => openAssignment()}><Plus size={14} />Add assignment</button></Empty>}
      <div className={styles.panelFoot}><span className={styles.legendDot} />Scheduled<span className={`${styles.legendDot} ${styles.completedDot}`} />Completed <span className={styles.calendarHint}>Select a day to plan work, or an assignment to edit it.</span></div>
    </section>
    {draft && <Modal title={editing ? "Edit assignment" : "New assignment"} onClose={() => setDraft(null)}>
      <form className={styles.form} onSubmit={saveAssignment}>
        <label>Assignment title<input autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required maxLength={120} /></label>
        <div className={styles.formGrid}><label>Employee<select value={draft.employeeId} required onChange={(event) => setDraft({ ...draft, employeeId: event.target.value })}><option value="" disabled>Select employee</option>{workspace.employees.filter((employee) => employee.status === "Active" || employee.id === draft.employeeId).map((employee) => <option key={employee.id} value={employee.id}>{employee.name}{employee.status === "Inactive" ? " (inactive)" : ""}</option>)}</select></label><label>Field<select value={draft.fieldId} required onChange={(event) => setDraft({ ...draft, fieldId: event.target.value })}><option value="" disabled>Select field</option>{data.filterOptions.fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select></label></div>
        <label>Date<input type="date" value={draft.date} required onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
        <div className={styles.formGrid}><label>Start time<input type="time" value={draft.startTime} required onChange={(event) => setDraft({ ...draft, startTime: event.target.value })} /></label><label>End time<input type="time" value={draft.endTime} required onChange={(event) => setDraft({ ...draft, endTime: event.target.value })} /></label></div>
        <p className={styles.help}>Times use the farm timezone: {workspace.settings.timezone.replaceAll("_", " ")}.</p>
        <label>Notes <span className={styles.optional}>Optional</span><textarea rows={3} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Equipment, supplies, or instructions for this work" maxLength={2000} /></label>
        <label className={styles.checkboxLabel}><input type="checkbox" checked={draft.status === "Completed"} onChange={(event) => setDraft({ ...draft, status: event.target.checked ? "Completed" : "Scheduled" })} />Mark as completed</label>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {confirmDelete ? <div className={styles.deletePrompt}><p>Delete this assignment from the schedule?</p><div className={styles.rowButtons}><button type="button" className={styles.button} onClick={() => setConfirmDelete(false)}>Keep assignment</button><button type="button" className={styles.dangerButton} disabled={saving} onClick={() => void removeAssignment()}>{saving ? "Deleting…" : "Delete assignment"}</button></div></div> : <div className={styles.formActions}>{editing && <button type="button" className={`${styles.iconButton} ${styles.deleteButton}`} aria-label="Delete assignment" onClick={() => setConfirmDelete(true)}><Trash2 size={17} /></button>}<button type="button" className={styles.button} onClick={() => setDraft(null)}>Cancel</button><button type="submit" className={styles.primaryButton} disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Create assignment"}</button></div>}
      </form>
    </Modal>}
  </div>;
}
