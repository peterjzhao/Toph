"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpRight, AudioLines, CalendarDays, Check, CheckCheck, Clock3, Download, MessageSquare, Pencil, Plus, Search, Send, Users } from "lucide-react";
import type { Employee } from "@/contracts/workspace";
import type { LogDto } from "@/contracts/dashboard";
import { InviteCode } from "../accounts/account-page";
import { mergeEmployeeEdit } from "@/lib/employee-edit";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { Modal, PageHeader } from "@/components/workspace/workspace-ui";
import styles from "./team.module.css";

const initials = (name: string) => name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
const hoursFor = (log: LogDto) => Math.max(0, (new Date(log.endAt).getTime() - new Date(log.startAt).getTime()) / 3_600_000) || 0;
const displayHours = (hours: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(hours);
const displayDate = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`));

function Avatar({ name, large = false, src }: { name: string; large?: boolean; src?: string }) {
  return <span aria-hidden="true" className={`${styles.avatar} ${large ? styles.largeAvatar : ""}`}>{src ? <img src={src} alt="" /> : initials(name)}</span>;
}

function StatCard({ label, value, detail, icon }: { label: string; value: string | number; detail: string; icon: React.ReactNode }) {
  return <div className={styles.stat}><div className={styles.statLabel}>{icon}{label}</div><div className={styles.statValue}>{value}</div><p>{detail}</p></div>;
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className={styles.empty}><span className={styles.emptyIcon}><Search size={20} /></span><h3>{title}</h3><p>{description}</p></div>;
}

function EmployeeForm({ employee, onClose }: { employee: Employee | null; onClose: () => void }) {
  const { workspace, update, saving, notify, account } = useWorkspace();
  const [name, setName] = useState(employee?.name ?? "");
  const [role, setRole] = useState(employee?.role ?? "Farm worker");
  const [email, setEmail] = useState(employee?.email ?? "");
  const [phone, setPhone] = useState(employee?.phone ?? "");
  const [status, setStatus] = useState<Employee["status"]>(employee?.status ?? "Active");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!name.trim() || !role.trim()) { setError("Enter a name and role for this employee."); return; }
    if (!employee && workspace.employees.length >= 250) { setError("This farm workspace supports up to 250 employee profiles."); return; }
    if ((!employee || email.trim() !== employee.email) && email.trim() && workspace.employees.some((item) => item.id !== employee?.id && item.email.toLowerCase() === email.trim().toLowerCase())) {
      setError("Another employee already uses that email address."); return;
    }
    const next: Employee = { id: employee?.id ?? crypto.randomUUID(), name: name.trim(), role: role.trim(), email: email.trim(), phone: phone.trim(), status, joinedAt: employee?.joinedAt ?? new Date().toISOString().slice(0, 10) };
    const saved = await update("employees", (previous) => employee ? previous.map((item) => item.id === employee.id ? mergeEmployeeEdit(item, employee, next) : item) : [...previous, next]);
    if (saved) { notify(employee ? "Employee details updated." : `${next.name} added to your team.`); onClose(); }
    else setError("The employee could not be saved. Your changes are still here; please try again.");
  }

  return <Modal title={employee ? "Edit employee" : "Add employee"} onClose={onClose}>
    <form className={styles.form} onSubmit={submit}>
      <p className={styles.formIntro}>Keep the people behind your farm&apos;s activity up to date.</p>
      <label>Full name<input autoFocus required disabled={saving || !account.farm.isDemo} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>
      <label>Role<input required disabled={saving} maxLength={80} value={role} onChange={(event) => setRole(event.target.value)} /></label>
      <div className={styles.formGrid}><label>Email <span className={styles.optional}>(optional)</span><input type="email" disabled={saving} maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="alex@example.com" autoComplete="email" /></label><label>Phone <span className={styles.optional}>(optional)</span><input type="tel" disabled={saving} maxLength={60} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Phone number" autoComplete="tel" /></label></div>
      <label>Status<select disabled={saving} value={status} onChange={(event) => setStatus(event.target.value as Employee["status"])}><option>Active</option><option>Inactive</option></select></label>
      <p className={styles.caption}>{account.farm.isDemo ? "This creates a profile in the sample farm workspace." : "Set a worker to Inactive to remove access. Their recorded work is preserved."}</p>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.formActions}><button className={styles.button} type="button" onClick={onClose}>Cancel</button><button className={styles.primaryButton} type="submit" disabled={saving}>{saving ? "Saving…" : employee ? "Save changes" : "Add employee"}</button></div>
    </form>
  </Modal>;
}

export function EmployeesPage() {
  const { workspace, data, avatars, account } = useWorkspace();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [role, setRole] = useState("all");
  const [editing, setEditing] = useState<Employee | null | undefined>(undefined);
  const [inviting, setInviting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const roles = [...new Set(workspace.employees.map((item) => item.role))].sort();
  const employees = workspace.employees.filter((employee) => (status === "all" || employee.status === status) && (role === "all" || employee.role === role) && `${employee.name} ${employee.role} ${employee.email}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = workspace.employees.find((employee) => employee.id === selectedId);
  const selectedLogs = data.logs.filter((log) => log.employee.id === selectedId).sort((a, b) => b.date.localeCompare(a.date));
  const activeCount = workspace.employees.filter((employee) => employee.status === "Active").length;
  const loggedEmployees = new Set(data.logs.map((log) => log.employee.id)).size;

  return <div className={styles.page}>
    <PageHeader title="Employees"><button className={styles.primaryButton} onClick={() => account.farm.isDemo ? setEditing(null) : setInviting(true)}><Plus size={16} />{account.farm.isDemo ? "Add employee" : "Invite workers"}</button></PageHeader>
    {inviting && <Modal title="Invite workers" onClose={() => setInviting(false)}><InviteCode compact /></Modal>}
    <div className={styles.stats}>
      <StatCard label="Team members" value={workspace.employees.length} detail="Profiles in your farm workspace" icon={<Users size={16} />} />
      <StatCard label="Active employees" value={activeCount} detail={`${workspace.employees.length - activeCount} inactive profiles`} icon={<Check size={16} />} />
      <StatCard label="Contributing workers" value={loggedEmployees} detail="Workers with recorded activity" icon={<AudioLines size={16} />} />
    </div>
    <section className={styles.card} aria-label="Employee directory">
      <div className={styles.cardToolbar}><h2>Team directory <span>({employees.length})</span></h2><div className={styles.controls}><label className={styles.search}><Search size={15} /><input type="search" aria-label="Search employees" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search employees" /></label><select className={styles.select} aria-label="Filter employees by role" value={role} onChange={(event) => setRole(event.target.value)}><option value="all">All roles</option>{roles.map((item) => <option key={item}>{item}</option>)}</select><select className={styles.select} aria-label="Filter employees by status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option>Active</option><option>Inactive</option></select></div></div>
      {employees.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Employee</th><th>Role</th><th>Contact</th><th>Status</th><th>Logs</th><th><span className={styles.srOnly}>Actions</span></th></tr></thead><tbody>{employees.map((employee) => {
        const logs = data.logs.filter((log) => log.employee.id === employee.id);
        return <tr key={employee.id}><td><button className={styles.personButton} onClick={() => setSelectedId(employee.id)}><Avatar name={employee.name} src={avatars[employee.id]} /><span>{employee.name}<small>View profile</small></span></button></td><td>{employee.role}</td><td><span className={styles.contact}>{employee.email || "No email added"}<small>{employee.phone || "No phone added"}</small></span></td><td><span className={`${styles.badge} ${employee.status === "Active" ? styles.greenBadge : styles.grayBadge}`}><span className={styles.statusDot} />{employee.status}</span></td><td>{logs.length}</td><td><div className={styles.rowActions}><Link className={styles.iconButton} aria-label={`Message ${employee.name}`} href={`/messages?employee=${encodeURIComponent(employee.id)}`}><MessageSquare size={16} /></Link><button className={styles.button} onClick={() => setEditing(employee)} aria-label={`Edit ${employee.name}`}><Pencil size={13} />Edit</button></div></td></tr>;
      })}</tbody></table></div> : <EmptyState title="No employees found" description="Try a different name, role, or status filter." />}
    </section>
    {editing !== undefined && <EmployeeForm employee={editing} onClose={() => setEditing(undefined)} />}
    {selected && <Modal title="Employee profile" onClose={() => setSelectedId(null)} wide>
      <div className={styles.profileHeader}><Avatar name={selected.name} src={avatars[selected.id]} large /><div><h3>{selected.name}</h3><p>{selected.role}</p><span className={`${styles.badge} ${selected.status === "Active" ? styles.greenBadge : styles.grayBadge}`}>{selected.status}</span></div></div>
      <dl className={styles.profileDetails}><div><dt>Email</dt><dd>{selected.email || "Not added"}</dd></div><div><dt>Phone</dt><dd>{selected.phone || "Not added"}</dd></div><div><dt>Joined</dt><dd>{displayDate(selected.joinedAt)}</dd></div><div><dt>Recorded hours</dt><dd>{displayHours(selectedLogs.reduce((total, log) => total + hoursFor(log), 0))} h</dd></div></dl>
      <div className={styles.sectionHeading}><h3>Recent activity</h3><span>{selectedLogs.length} logs</span></div>
      {selectedLogs.length ? <div className={styles.relatedLogs}>{selectedLogs.slice(0, 6).map((log) => <Link key={log.id} href={`/activity-logs?log=${encodeURIComponent(log.id)}`}><span className={styles.relatedIcon}><AudioLines size={17} /></span><span><strong>{log.activity}</strong><small>{log.field.name} · {displayDate(log.date)}</small></span><ArrowUpRight size={16} /></Link>)}</div> : <p className={styles.quietBox}>No activity has been recorded for this employee yet.</p>}
      <div className={styles.formActions}><button className={styles.button} onClick={() => { setSelectedId(null); setEditing(selected); }}><Pencil size={14} />Edit profile</button><Link className={styles.primaryButton} href={`/messages?employee=${encodeURIComponent(selected.id)}`}><MessageSquare size={15} />Message</Link></div>
    </Modal>}
  </div>;
}

type PerformanceSort = "name" | "logs" | "hours";

function csvCell(value: unknown) {
  const text = String(value ?? "");
  // Match report exports: leading whitespace must not conceal spreadsheet formulas.
  const safe = /^[\s\uFEFF]*[=+@\-]|^[\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function PerformancePage() {
  const { data, workspace, avatars, notify } = useWorkspace();
  const [from, setFrom] = useState("2026-04-01");
  const [to, setTo] = useState("2026-04-30");
  const [sort, setSort] = useState<PerformanceSort>("hours");
  const [descending, setDescending] = useState(true);
  const invalidRange = !!from && !!to && from > to;
  const logs = useMemo(() => invalidRange ? [] : data.logs.filter((log) => (!from || log.date >= from) && (!to || log.date <= to)), [data.logs, from, to, invalidRange]);
  const totalHours = logs.reduce((total, log) => total + hoursFor(log), 0);
  const activeWorkers = new Set(logs.map((log) => log.employee.id)).size;
  const activityHours = [...new Set(logs.map((log) => log.activity))].map((activity) => {
    const matches = logs.filter((log) => log.activity === activity);
    return { activity, hours: matches.reduce((total, log) => total + hoursFor(log), 0), logs: matches.length };
  }).sort((a, b) => b.hours - a.hours || a.activity.localeCompare(b.activity));
  const workers = useMemo(() => {
    const employees = new Map(workspace.employees.map((employee) => [employee.id, { id: employee.id, name: employee.name, role: employee.role }]));
    logs.forEach((log) => { if (!employees.has(log.employee.id)) employees.set(log.employee.id, { ...log.employee, role: "Farm Worker" }); });
    return [...employees.values()].map((employee) => {
      const employeeLogs = logs.filter((log) => log.employee.id === employee.id);
      return { ...employee, count: employeeLogs.length, hours: employeeLogs.reduce((total, log) => total + hoursFor(log), 0), fields: new Set(employeeLogs.map((log) => log.field.id)).size };
    }).sort((a, b) => ((sort === "name" ? a.name.localeCompare(b.name) : sort === "logs" ? a.count - b.count : a.hours - b.hours) * (descending ? -1 : 1)) || a.name.localeCompare(b.name));
  }, [workspace.employees, logs, sort, descending]);

  function changeSort(next: PerformanceSort) { if (sort === next) setDescending(!descending); else { setSort(next); setDescending(next !== "name"); } }
  function download() {
    const rows: unknown[][] = [["Employee", "Role", "Logs", "Recorded hours", "Fields", "From", "To"], ...workers.map((worker) => [worker.name, worker.role, worker.count, worker.hours.toFixed(2), worker.fields, from || "All", to || "All"])];
    const url = URL.createObjectURL(new Blob(["\uFEFF", rows.map((row) => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a"); link.href = url; link.download = `toph-performance-${from || "all"}-${to || "all"}.csv`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify("Performance report downloaded.");
  }

  return <div className={styles.page}>
    <PageHeader title="Performance"><button className={styles.button} onClick={download} disabled={invalidRange}><Download size={16} />Export CSV</button></PageHeader>
    <div className={styles.periodBar}><div><CalendarDays size={16} /><span>Reporting period</span></div><div className={styles.dateControls}><label>From<input type="date" aria-label="Performance start date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><span className={styles.dateDash}>—</span><label>To<input type="date" aria-label="Performance end date" value={to} onChange={(event) => setTo(event.target.value)} /></label><button className={styles.textButton} onClick={() => { setFrom("2026-04-01"); setTo("2026-04-30"); }}>April 2026</button></div></div>
    {invalidRange && <p className={styles.error} role="alert">Choose an end date on or after the start date.</p>}
    <div className={styles.stats}>
      <StatCard label="Recorded hours" value={`${displayHours(totalHours)} h`} detail="Duration of the selected activity logs" icon={<Clock3 size={16} />} />
      <StatCard label="Activity logs" value={logs.length} detail={`${activityHours.length} distinct ${activityHours.length === 1 ? "activity" : "activities"}`} icon={<AudioLines size={16} />} />
      <StatCard label="Contributing workers" value={activeWorkers} detail="Workers with logs in this period" icon={<Users size={16} />} />
    </div>
    <section className={styles.card}><div className={styles.cardToolbar}><h2>Hours by activity</h2><span className={styles.mutedLabel}>Recorded duration</span></div>{activityHours.length ? <div className={styles.activityChart}>{activityHours.map((item) => <div className={styles.chartRow} key={item.activity}><div className={styles.chartLabel}>{item.activity}<small>{item.logs} {item.logs === 1 ? "log" : "logs"}</small></div><div className={styles.barTrack}><div className={styles.barFill} style={{ width: `${Math.max(1, item.hours / Math.max(...activityHours.map((activity) => activity.hours), 1) * 100)}%` }} /></div><span className={styles.barValue}>{displayHours(item.hours)} h</span></div>)}</div> : <EmptyState title="No recorded activity" description="Choose a date range that includes activity logs. The sample logs are from April 2026." />}</section>
    <section className={styles.card}><div className={styles.cardToolbar}><h2>Employee breakdown <span>({workers.length})</span></h2><span className={styles.mutedLabel}>Click a column to sort</span></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th aria-sort={sort === "name" ? descending ? "descending" : "ascending" : "none"}><button className={styles.sortButton} onClick={() => changeSort("name")}>Employee{sort === "name" && (descending ? <ArrowDown size={13} /> : <ArrowUp size={13} />)}</button></th><th aria-sort={sort === "logs" ? descending ? "descending" : "ascending" : "none"}><button className={styles.sortButton} onClick={() => changeSort("logs")}>Activity logs{sort === "logs" && (descending ? <ArrowDown size={13} /> : <ArrowUp size={13} />)}</button></th><th aria-sort={sort === "hours" ? descending ? "descending" : "ascending" : "none"}><button className={styles.sortButton} onClick={() => changeSort("hours")}>Recorded hours{sort === "hours" && (descending ? <ArrowDown size={13} /> : <ArrowUp size={13} />)}</button></th><th>Fields worked</th><th>Share of hours</th></tr></thead><tbody>{workers.map((worker) => <tr key={worker.id}><td><div className={styles.person}><Avatar name={worker.name} src={avatars[worker.id]} /><span>{worker.name}<small>{worker.role}</small></span></div></td><td>{worker.count}</td><td>{displayHours(worker.hours)} h</td><td>{worker.fields}</td><td><div className={styles.share}><span>{totalHours ? Math.round(worker.hours / totalHours * 100) : 0}%</span><div><i style={{ width: `${totalHours ? worker.hours / totalHours * 100 : 0}%` }} /></div></div></td></tr>)}</tbody></table></div></section>
    <p className={styles.pageNote}>Hours are calculated from each log&apos;s start and end time. These are recorded activity totals, not payroll, productivity ratings, or measured AI accuracy.</p>
  </div>;
}

export function MessagesPage() {
  const { workspace, avatars, sendMessage, markMessagesRead, messageError } = useWorkspace();
  const [saving, setSaving] = useState(false);
  const [visible, setVisible] = useState(true);
  const pendingSends = useRef<Record<string, { id: string; body: string }>>({});
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestedId = searchParams.get("employee");
  const newestMessage = [...workspace.messages].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const [selectedId, setSelectedId] = useState(requestedId ?? newestMessage?.employeeId ?? workspace.employees[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [compose, setCompose] = useState(false);
  const [contactQuery, setContactQuery] = useState("");
  const [sendErrors, setSendErrors] = useState<Record<string, string>>({});
  const [readErrors, setReadErrors] = useState<Record<string, string>>({});
  const draftVersions = useRef<Record<string, number>>({});
  const sending = useRef(false);
  const lastReadAttempt = useRef("");
  const conversationEnd = useRef<HTMLDivElement>(null);
  const selected = workspace.employees.find((employee) => employee.id === selectedId);
  const messages = workspace.messages.filter((message) => message.employeeId === selectedId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const unreadCount = workspace.messages.filter((message) => message.from === "employee" && !message.read).length;
  const draft = drafts[selectedId] ?? "";
  const error = sendErrors[selectedId] ?? "";
  const people = workspace.employees.filter((employee) => `${employee.name} ${employee.role}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => {
    const aLatest = workspace.messages.filter((message) => message.employeeId === a.id).reduce((date, message) => message.createdAt > date ? message.createdAt : date, "");
    const bLatest = workspace.messages.filter((message) => message.employeeId === b.id).reduce((date, message) => message.createdAt > date ? message.createdAt : date, "");
    return bLatest.localeCompare(aLatest) || a.name.localeCompare(b.name);
  });

  const markRead = useCallback(async (employeeId: string, messageIds: string[]) => {
    setReadErrors((previous) => ({ ...previous, [employeeId]: "" }));
    if (!messageIds.length) return;
    lastReadAttempt.current = `${employeeId}:${messageIds.join(",")}`;
    try { await markMessagesRead({ employeeId, messageIds }); }
    catch { setReadErrors((previous) => ({ ...previous, [employeeId]: "We couldn’t save this conversation’s read status. Your messages are still available." })); }
  }, [markMessagesRead]);

  useEffect(() => { if (requestedId) setSelectedId(requestedId); }, [requestedId]);
  useEffect(() => {
    const changed = () => setVisible(document.visibilityState === "visible");
    changed(); document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useEffect(() => { conversationEnd.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [selectedId, messages.length]);
  useEffect(() => {
    const unread = workspace.messages.filter((message) => message.employeeId === selectedId && message.from === "employee" && !message.read);
    const key = `${selectedId}:${unread.map((message) => message.id).join(",")}`;
    if (!unread.length || saving || !visible || lastReadAttempt.current === key) return;
    void markRead(selectedId, unread.map((message) => message.id));
  }, [selectedId, workspace.messages, saving, visible, markRead]);

  function openConversation(id: string) {
    setSelectedId(id); setCompose(false); setContactQuery(""); lastReadAttempt.current = "";
    router.replace(`/messages?employee=${encodeURIComponent(id)}`, { scroll: false });
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim() || !selected || selected.status !== "Active" || saving || sending.current) return;
    const recipientId = selected.id;
    if (workspace.messages.length >= 2000) { setSendErrors((previous) => ({ ...previous, [recipientId]: "This farm workspace has reached its limit of 2,000 messages. Your draft is still here." })); return; }
    const submittedVersion = draftVersions.current[recipientId] ?? 0;
    const previousSend = pendingSends.current[recipientId];
    const attempt = previousSend?.body === draft.trim() ? previousSend : { id: crypto.randomUUID(), body: draft.trim() };
    pendingSends.current[recipientId] = attempt;
    sending.current = true; setSaving(true);
    try {
      await sendMessage({ ...attempt, employeeId: recipientId });
      delete pendingSends.current[recipientId];
      // A slow save must not erase edits made after Send, even if the user switches conversations.
      setDrafts((previous) => (draftVersions.current[recipientId] ?? 0) === submittedVersion ? { ...previous, [recipientId]: "" } : previous);
      setSendErrors((previous) => ({ ...previous, [recipientId]: "" }));
    } catch (cause) { setSendErrors((previous) => ({ ...previous, [recipientId]: cause instanceof Error ? cause.message : "Your message could not be sent. Try again; your draft is still here." })); }
    finally { sending.current = false; setSaving(false); }
  }
  const messageTime = (date: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: workspace.settings.timezone || "America/Los_Angeles" }).format(new Date(date));
  const messageDay = (date: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: workspace.settings.timezone || "America/Los_Angeles" }).format(new Date(date));

  return <div className={`${styles.page} ${styles.messagesPage}`}>
    <PageHeader title="Messages"><button className={styles.primaryButton} onClick={() => setCompose(true)}><Pencil size={15} />New message</button></PageHeader>
    {messageError && <p className={styles.error} role="status">{messageError}</p>}
    <div className={styles.messenger}>
      <aside className={styles.conversations} aria-label="Conversations"><div className={styles.conversationsHeader}><h2>Team inbox</h2>{unreadCount > 0 && <span className={styles.unreadTotal}>{unreadCount}</span>}</div><label className={`${styles.search} ${styles.contactSearch}`}><Search size={15} /><input aria-label="Search conversations" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your team" /></label><div className={styles.conversationList}>{people.map((employee) => {
        const thread = workspace.messages.filter((message) => message.employeeId === employee.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const latest = thread.at(-1);
        const unread = thread.filter((message) => message.from === "employee" && !message.read).length;
        return <button key={employee.id} className={`${styles.conversationButton} ${selectedId === employee.id ? styles.selectedConversation : ""}`} onClick={() => openConversation(employee.id)} aria-pressed={selectedId === employee.id}><Avatar name={employee.name} src={avatars[employee.id]} /><span className={styles.conversationCopy}><span><strong>{employee.name}</strong>{latest && <time dateTime={latest.createdAt}>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: workspace.settings.timezone || "America/Los_Angeles" }).format(new Date(latest.createdAt))}</time>}</span><small>{latest ? `${latest.from === "admin" ? "You: " : ""}${latest.body}` : "Start a conversation"}</small></span>{unread > 0 && <span aria-label={`${unread} unread messages`} className={styles.unreadDot}>{unread}</span>}</button>;
      })}{!people.length && <p className={styles.noContacts}>No team members match your search.</p>}</div></aside>
      <section className={styles.conversation} aria-label={selected ? `Conversation with ${selected.name}` : "Select a conversation"}>
        {selected ? <><div className={styles.conversationHeader}><Avatar name={selected.name} src={avatars[selected.id]} /><div><h2>{selected.name}</h2><p>{selected.role} <span>·</span> {selected.status}</p></div><Link className={styles.iconButton} href="/employees" aria-label="Open employee directory"><Users size={17} /></Link></div>{readErrors[selectedId] && <div className={styles.readError} role="alert"><span>{readErrors[selectedId]}</span><button type="button" disabled={saving} onClick={() => void markRead(selectedId, messages.filter((message) => message.from === "employee" && !message.read).map((message) => message.id))}>Retry</button></div>}<div className={styles.messageArea} aria-live="polite" aria-relevant="additions text">
          {!messages.length && <div className={styles.conversationEmpty}><span className={styles.emptyIcon}><MessageSquare size={22} /></span><h3>Start a conversation with {selected.name.split(" ")[0]}</h3><p>Share a field update, ask a question, or plan the day&apos;s work.</p></div>}
          {messages.map((message, index) => <div key={message.id}>{(index === 0 || messageDay(messages[index - 1].createdAt) !== messageDay(message.createdAt)) && <div className={styles.dateSeparator}><span>{messageDay(message.createdAt)}</span></div>}<div className={`${styles.messageRow} ${message.from === "admin" ? styles.outgoing : styles.incoming}`}><div className={styles.messageBubble}><p>{message.body}</p><span className={styles.messageMeta}><time dateTime={message.createdAt}>{messageTime(message.createdAt)}</time>{message.from === "admin" && <span title={message.read ? "Read by worker" : "Sent to inbox"} aria-label={message.read ? "Read by worker" : "Sent to inbox"}>{message.read ? <CheckCheck size={12} /> : <Check size={12} />}</span>}</span></div></div></div>)}<div ref={conversationEnd} />
        </div><div className={styles.composerWrapper}><p className={styles.workspaceNote}>Messages reach the worker’s inbox. Updates appear while the app is open.</p><form className={styles.composer} onSubmit={send}><label className={styles.srOnly} htmlFor="message-draft">Message to {selected.name}</label><textarea id="message-draft" placeholder={`Message ${selected.name.split(" ")[0]}…`} value={draft} maxLength={4000} rows={2} onChange={(event) => { const value = event.target.value; draftVersions.current[selectedId] = (draftVersions.current[selectedId] ?? 0) + 1; setDrafts((previous) => ({ ...previous, [selectedId]: value })); setSendErrors((previous) => ({ ...previous, [selectedId]: "" })); }} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><button type="submit" className={styles.sendButton} disabled={!draft.trim() || saving || selected.status !== "Active"} aria-label={`Send message to ${selected.name}`}><Send size={17} /><span>{saving ? "Saving…" : "Send"}</span></button></form><div className={styles.composerHint}><span>⌘ / Ctrl + Enter to send</span><span>{draft.length.toLocaleString()} / 4,000</span></div>{error && <p className={styles.error} role="alert">{error}</p>}</div></> : <EmptyState title="Choose a conversation" description="Invite a worker to your farm, then select them to start a conversation." />}
      </section>
    </div>
    {compose && <Modal title="New message" onClose={() => setCompose(false)}><p className={styles.formIntro}>Choose a team member to start a conversation.</p><label className={`${styles.search} ${styles.modalSearch}`}><Search size={15} /><input autoFocus type="search" aria-label="Find a message recipient" placeholder="Search name or role" value={contactQuery} onChange={(event) => setContactQuery(event.target.value)} /></label><div className={styles.recipientList}>{workspace.employees.filter((employee) => `${employee.name} ${employee.role}`.toLowerCase().includes(contactQuery.trim().toLowerCase())).map((employee) => <button onClick={() => openConversation(employee.id)} key={employee.id}><Avatar name={employee.name} src={avatars[employee.id]} /><span>{employee.name}<small>{employee.role}</small></span><ArrowUpRight size={16} /></button>)}{!workspace.employees.some((employee) => `${employee.name} ${employee.role}`.toLowerCase().includes(contactQuery.trim().toLowerCase())) && <p className={styles.noContacts}>No matching employees. Add a profile from the Employees page.</p>}</div><Link href="/employees" className={styles.directoryLink}><Users size={14} />Manage employee directory<ArrowUpRight size={14} /></Link></Modal>}
  </div>;
}
