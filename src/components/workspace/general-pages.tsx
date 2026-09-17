"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowUpRight, ChevronRight, Expand, LifeBuoy, Minus, Plus, Settings2 } from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { Badge, Button, EmptyState, Modal, PageHeader, Panel } from "./workspace-ui";
import type { SupportTicket, WorkspaceSettings } from "@/contracts/workspace";
import { formatDate } from "@/lib/format";
import { fieldMapImage } from "@/lib/field-map";
import { FieldMap } from "@/components/dashboard/field-map";
import s from "./workspace.module.css";

export function MapPage() {
  const { data } = useWorkspace();
  const query = useSearchParams();
  const router = useRouter();
  const selected = query.get("field") ?? data.filterOptions.fields[0]?.id ?? "";
  function selectField(id: string) {
    const next = new URLSearchParams(query.toString());
    next.set("field", id);
    router.push(`/map?${next.toString()}`, { scroll: false });
    setZoom(1);
  }
  const [search, setSearch] = useState(""); const [zoom, setZoom] = useState(1); const [expanded, setExpanded] = useState(false);
  const field = data.filterOptions.fields.find(item => item.id === selected) ?? data.filterOptions.fields[0];
  const logs = data.logs.filter(log => log.field.id === field?.id);
  const image = field ? fieldMapImage(field.id, logs[0]?.field.mapImageUrl) : "";
  const hours = logs.reduce((sum, log) => sum + (Date.parse(log.endAt) - Date.parse(log.startAt)) / 3600000, 0);
  const zoomControls = <div className={s.inlineActions}><button aria-label="Zoom out" className={s.iconButton} disabled={zoom === 1} onClick={() => setZoom(Math.max(1, zoom - .5))}><Minus size={16}/></button><button className={s.secondaryButton} onClick={() => setZoom(1)} aria-label="Reset map zoom">{Math.round(zoom * 100)}%</button><button aria-label="Zoom in" className={s.iconButton} disabled={zoom === 3} onClick={() => setZoom(Math.min(3, zoom + .5))}><Plus size={16}/></button></div>;
  const renderMap = () => image && field ? <div className={s.fieldMapViewport}><FieldMap field={field} fields={data.filterOptions.fields} imageUrl={image} zoom={zoom} onSelect={selectField} /></div> : <EmptyState title="No imagery available" description="There is no map attached to this field."/>;
  return <div className={s.page}><PageHeader title="Map" description="Explore your fields and the work recorded on them"><Badge>{data.filterOptions.fields.length} fields</Badge></PageHeader>
    <div className={s.split}><Panel><div className={s.panelBody}><label className={s.eyebrow} htmlFor="field-search">Your fields</label><input id="field-search" className={s.searchInput} style={{ marginTop: 12 }} type="search" placeholder="Search fields" value={search} onChange={event => setSearch(event.target.value)}/></div><div className={s.fieldList}>{data.filterOptions.fields.filter(item => item.name.toLowerCase().includes(search.toLowerCase())).map(item => <button key={item.id} className={`${s.fieldButton} ${field?.id === item.id ? s.fieldSelected : ""}`} onClick={() => selectField(item.id)} aria-pressed={field?.id === item.id}><div><strong>{item.name}</strong><small>{data.logs.filter(log => log.field.id === item.id).length} activity log</small></div><ChevronRight size={15}/></button>)}</div>{!data.filterOptions.fields.some(item => item.name.toLowerCase().includes(search.toLowerCase())) && <EmptyState title="No matching fields"/>}</Panel>
      <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}><Panel><div className={s.panelHeading}><div><h2>{field?.name ?? "Field map"}</h2><p>{data.farm.name} · Satellite preview</p></div>{image && <Button secondary onClick={() => setExpanded(true)}><Expand size={15}/>Expand map</Button>}</div>{renderMap()}<div className={s.mapCaption}><span className={s.demoNote}>Click a field to view its activity.</span>{zoomControls}</div></Panel>
      <Panel><div className={s.detailsGrid}><div><span>ACTIVITY LOGS</span><strong>{logs.length}</strong></div><div><span>LOGGED HOURS</span><strong>{hours.toFixed(1)} h</strong></div><div><span>LATEST ACTIVITY</span><strong>{logs.at(-1)?.activity ?? "No activity"}</strong></div></div><div className={s.smallList}>{logs.map(log => <Link key={log.id} href={`/activity-logs?log=${log.id}`}><div><strong>{log.activity} · {log.employee.name}</strong><p>{formatDate(log.date)}</p></div><ArrowUpRight size={16}/></Link>)}</div></Panel></div>
    </div>{expanded && <Modal wide title={`${field?.name} · Satellite preview`} onClose={() => setExpanded(false)}>{renderMap()}<div className={s.mapCaption}>{zoomControls}<span className={s.demoNote}>Click a field to view its activity.</span></div></Modal>}
  </div>;
}

export function SettingsPage() {
  const { workspace, data, update, saving, notify } = useWorkspace();
  const [draft, setDraft] = useState<WorkspaceSettings>(() => structuredClone(workspace.settings));
  const [error, setError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(workspace.settings);
  async function save(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!draft.farmName.trim() || !draft.contactName.trim()) { setError("Enter a farm name and administrator name."); return; }
    if (await update("settings", { ...draft, farmName: draft.farmName.trim(), contactName: draft.contactName.trim(), email: draft.email.trim() })) notify("Your farm settings have been saved.");
  }
  return <div className={s.page}><PageHeader title="Settings" description="Manage your farm profile and workspace preferences"><Badge tone="green">Demo workspace</Badge></PageHeader>
    <form onSubmit={save} className={s.settingsGrid}><Panel><div className={s.panelHeading}><div><h2>Farm profile</h2><p>The details your team sees in this workspace.</p></div><Settings2 size={18} color="#888"/></div><div className={`${s.panelBody} ${s.form}`}><div className={s.formGrid}><label>Farm name<input required maxLength={100} value={draft.farmName} onChange={event => setDraft({ ...draft, farmName: event.target.value })}/></label><label>Administrator name<input required maxLength={100} value={draft.contactName} onChange={event => setDraft({ ...draft, contactName: event.target.value })}/></label></div><label>Contact email<input type="email" maxLength={254} placeholder="name@example.com" value={draft.email} onChange={event => setDraft({ ...draft, email: event.target.value })}/></label><label>Display timezone<select value={draft.timezone} onChange={event => setDraft({ ...draft, timezone: event.target.value })}>{["America/Los_Angeles","America/Denver","America/Chicago","America/New_York","Europe/London","UTC"].map(zone => <option key={zone}>{zone}</option>)}</select></label><p className={s.demoNote}>Used when displaying work times on the dashboard and activity logs. Activity dates remain the original farm dates.</p>{error && <p className={s.formError} role="alert">{error}</p>}<div className={s.formActions}><button type="button" className={s.secondaryButton} disabled={!dirty || saving} onClick={() => { setDraft(structuredClone(workspace.settings)); setError(""); }}>Discard changes</button><Button type="submit" disabled={!dirty || saving}>{saving ? "Saving…" : "Save changes"}</Button></div></div></Panel>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}><Panel><div className={s.panelHeading}><div><h2>Notification preferences</h2><p>Choose what you want to hear about.</p></div></div><div className={s.panelBody}>{([
        ["recordings", "New recordings", "When a worker adds an activity recording."], ["weekly", "Weekly summary", "A weekly overview of farm activity."], ["reminders", "Schedule reminders", "Upcoming assignments and field work."],
      ] as const).map(([key,title,description]) => <label key={key} className={s.toggleRow}><div><strong>{title}</strong><p>{description}</p></div><input type="checkbox" className={s.toggle} aria-label={title} checked={draft.notifications[key]} onChange={event => setDraft({ ...draft, notifications: { ...draft.notifications, [key]: event.target.checked } })}/></label>)}<p className={s.demoNote}>Preferences are saved here. External email delivery is not enabled for this demo.</p></div></Panel><Panel><div className={s.panelBody}><Badge tone="green">Database connected</Badge><p className={s.muted}>{data.logs.length} activity logs · April 2026 demo period</p><p className={s.demoNote}>Changes are stored in the local farm database. Your original activity records remain intact.</p><Link className={s.textButton} href="/support">Get help with your workspace <ArrowUpRight size={14}/></Link></div></Panel></div>
    </form>
  </div>;
}

const helpArticles = [
  { title: "How do I review a worker’s activity?", body: "Open Activity Logs and select a row or its View button. You’ll see the activity summary, attached recording when available, field map, and tags. Use search, Sort, or Filter to narrow the list.", href: "/activity-logs", label: "Open activity logs" },
  { title: "How do tags and audit reviews work?", body: "Add a tag from an expanded activity log to organize your records. In Audit Manager, review the details and approve or flag an entry with a note. Tags and review decisions are saved in the database.", href: "/audit-manager", label: "Open audit manager" },
  { title: "Can I export my farm records?", body: "Reports creates CSV files for activities, compliance reviews, or logged work hours. Choose your date range, generate a report, and open the downloaded file in your spreadsheet app.", href: "/reports", label: "Create a report" },
  { title: "How do I assign work to my team?", body: "Go to Schedule, create an assignment, and select an employee, field, date, and time. You can edit or complete an assignment from either the calendar or the list.", href: "/schedule", label: "Open schedule" },
  { title: "Why do these records show April 2026?", body: "This workspace uses sample farm data from the original design. Activity dates and the dashboard’s metric snapshot stay in April 2026 so the demo remains consistent. Performance calculates hours directly from those logs.", href: "/performance", label: "View performance" },
  { title: "Does switching users change access permissions?", body: "These are demo profiles sharing the same farm workspace. Switching changes the selected profile; it is not production authentication. Signing out clears this browser’s demo session.", href: "/switch-user", label: "Switch demo profile" },
];

export function SupportPage() {
  const { workspace, update, saving, notify } = useWorkspace();
  const [search, setSearch] = useState(""); const [creating, setCreating] = useState(false); const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [subject, setSubject] = useState(""); const [body, setBody] = useState(""); const [category, setCategory] = useState<SupportTicket["category"]>("General");
  const articles = helpArticles.filter(article => `${article.title} ${article.body}`.toLowerCase().includes(search.toLowerCase()));
  const ticket = workspace.tickets.find(item => item.id === selected);
  async function createTicket(event: FormEvent) {
    event.preventDefault(); setError(""); if (!subject.trim() || !body.trim()) { setError("Enter a subject and details for your request."); return; }
    const next: SupportTicket = { id: crypto.randomUUID(), subject: subject.trim(), body: body.trim(), category, status: "Open", createdAt: new Date().toISOString() };
    if (await update("tickets", previous => [...previous, next])) { setCreating(false); setSubject(""); setBody(""); notify("Support request saved in your workspace."); } else setError("The request could not be saved. Your details are still here; please try again.");
  }
  return <div className={s.page}><PageHeader title="Support" description="Find answers and keep track of requests for your farm"><Button onClick={() => { setError(""); setCreating(true); }}><Plus size={15}/>Create request</Button></PageHeader>
    <div className={s.settingsGrid}><Panel><div className={s.panelHeading}><div><h2>How can we help?</h2><p>A quick guide to your Toph workspace.</p></div><LifeBuoy size={20} color="#888"/></div><div className={s.panelBody}><input className={s.searchInput} type="search" aria-label="Search help articles" placeholder="Search help articles" value={search} onChange={event => setSearch(event.target.value)}/>{articles.map(article => <details key={article.title} className={s.faq}><summary>{article.title}</summary><p>{article.body}</p><Link href={article.href} className={s.textButton} style={{ marginTop: 12 }}>{article.label}<ArrowUpRight size={14}/></Link></details>)}{!articles.length && <EmptyState title="No matching articles" description="Try searching for tags, reports, or scheduling."/>}</div></Panel>
      <Panel><div className={s.panelHeading}><div><h2>Your requests</h2><p>{workspace.tickets.filter(item => item.status === "Open").length} open requests</p></div></div>{workspace.tickets.length ? <div className={s.smallList}>{[...workspace.tickets].reverse().map(item => <button key={item.id} className={s.fieldButton} onClick={() => { setError(""); setSelected(item.id); }}><div><strong>{item.subject}</strong><small>{item.category} · {new Date(item.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</small></div><Badge tone={item.status === "Open" ? "amber" : "green"}>{item.status}</Badge></button>)}</div> : <EmptyState title="You’re all caught up" description="Your saved support requests will appear here."/>}<div className={s.panelBody}><p className={s.demoNote}>Requests stay in this demo workspace. They are not sent to an external support team.</p></div></Panel>
    </div>{creating && <Modal title="Create a support request" onClose={() => setCreating(false)}><form className={s.form} onSubmit={createTicket}><label>Subject<input required maxLength={160} value={subject} onChange={event => setSubject(event.target.value)} placeholder="What do you need help with?"/></label><label>Category<select value={category} onChange={event => setCategory(event.target.value as SupportTicket["category"])}><option>General</option><option>Technical</option><option>Account</option></select></label><label>Details<textarea required maxLength={4000} value={body} onChange={event => setBody(event.target.value)} placeholder="Tell us what happened and what you expected."/></label><p className={s.demoNote}>Saved to this workspace only. No external message is sent.</p>{error && <p className={s.formError} role="alert">{error}</p>}<div className={s.formActions}><Button secondary type="button" onClick={() => setCreating(false)}>Cancel</Button><Button disabled={saving} type="submit">{saving ? "Saving…" : "Save request"}</Button></div></form></Modal>}
    {ticket && <Modal title={ticket.subject} onClose={() => setSelected(null)}><Badge tone={ticket.status === "Open" ? "amber" : "green"}>{ticket.status}</Badge><p className={s.muted}>{ticket.category} · {new Date(ticket.createdAt).toLocaleDateString()}</p><p style={{ color: "#555", lineHeight: 1.7, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{ticket.body}</p>{error && <p className={s.formError} role="alert">{error}</p>}<div className={s.formActions}><Button secondary onClick={() => setSelected(null)}>Done</Button><Button disabled={saving} onClick={async () => { if (await update("tickets", previous => previous.map(item => item.id === ticket.id ? { ...item, status: item.status === "Open" ? "Closed" : "Open" } : item))) notify(ticket.status === "Open" ? "Request closed." : "Request reopened."); else setError("The status could not be saved. Please try again."); }}>{ticket.status === "Open" ? "Close request" : "Reopen request"}</Button></div></Modal>}
  </div>;
}

export function AccountsPage({ login = false }: { login?: boolean }) {
  const { workspace, session, switchUser } = useWorkspace(); const router = useRouter();
  const [search, setSearch] = useState("");
  const profiles = [{ id: "admin", name: workspace.settings.contactName || "Ranch Admin", role: "Admin" }, ...workspace.employees.filter(person => person.status === "Active")];
  const cards = <><input type="search" aria-label="Find a demo profile" className={s.searchInput} style={{ maxWidth: 370, marginBottom: 22 }} placeholder="Find a profile" value={search} onChange={event => setSearch(event.target.value)}/><div className={s.profiles}>{profiles.filter(person => `${person.name} ${person.role}`.toLowerCase().includes(search.toLowerCase())).map(person => <button className={s.profileCard} key={person.id} onClick={() => { switchUser(person.id); router.push("/"); }}><span className={s.initials}>{person.name.split(" ").map(word => word[0]).join("").slice(0,2)}</span><div><strong>{person.name}</strong><p>{person.role} · {workspace.settings.farmName}</p></div>{!login && session?.id === person.id ? <Badge tone="green">Current profile</Badge> : <span className={s.textButton}>{login ? "Enter workspace" : "Switch to profile"}<ArrowUpRight size={14}/></span>}</button>)}</div>{!profiles.some(person => `${person.name} ${person.role}`.toLowerCase().includes(search.toLowerCase())) && <EmptyState title="No matching profiles" description="Try another name or role."/>}</>;
  if (login) return <div className={s.login}><section className={s.loginCard}><Badge tone="green">Toph · Demo workspace</Badge><h1>Welcome to {workspace.settings.farmName}</h1><p>You’re signed out. Choose a demo profile to continue.<br/>Profiles share the same farm data. No password is required.</p>{cards}</section></div>;
  return <div className={s.page}><PageHeader title="Switch User" description="Choose a profile to explore the farm workspace"/><p className={s.demoNote}>These demo profiles share the same data and access. This is a profile preview, not production sign-in.</p>{cards}</div>;
}
