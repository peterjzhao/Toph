"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useRef, type ChangeEvent, type FormEvent } from "react";
import { ArrowUpRight, ChevronRight, Expand, LifeBuoy, Plus, Settings2 } from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { Badge, Button, EmptyState, Modal, PageHeader, Panel } from "./workspace-ui";
import { InviteCode } from "../accounts/account-page";
import type { SupportTicket, WorkspaceSettings } from "@/contracts/workspace";
import { formatDate } from "@/lib/format";
import { fieldMapImage } from "@/lib/field-map";
import { FieldMap } from "@/components/dashboard/field-map";
import { FilterSelect } from "@/components/dashboard/filter-select";
import { FieldTimeline } from "./field-timeline";
import s from "./workspace.module.css";
import mapStyles from "../dashboard/dashboard.module.css";

export function MapPage() {
  const { data } = useWorkspace();
  const query = useSearchParams();
  const router = useRouter();
  const selected = query.get("field") ?? data.filterOptions.fields[0]?.id ?? "";
  function selectField(id: string) {
    const next = new URLSearchParams(query.toString());
    next.set("field", id);
    router.push(`/map?${next.toString()}`, { scroll: false });
  }
  const [search, setSearch] = useState(""); const [expanded, setExpanded] = useState(false);
  const field = data.filterOptions.fields.find(item => item.id === selected) ?? data.filterOptions.fields[0];
  const logs = data.logs.filter(log => log.field.id === field?.id);
  const image = field ? fieldMapImage(field.id, field.mapImageUrl ?? logs[0]?.field.mapImageUrl) : "";
  const hours = logs.reduce((sum, log) => sum + (Date.parse(log.endAt) - Date.parse(log.startAt)) / 3600000, 0);
  const renderMap = () => image && field ? <div className={mapStyles.mapLink}><FieldMap field={field} fields={data.filterOptions.fields} imageUrl={image} onSelect={selectField} /></div> : <EmptyState title="No imagery available" description="There is no map attached to this field."/>;
  return <div className={s.page}><PageHeader title="Map"><Badge>{data.filterOptions.fields.length} fields</Badge></PageHeader>
    <div className={s.split}><Panel><div className={s.panelBody}><label className={s.eyebrow} htmlFor="field-search">Your fields</label><input id="field-search" className={s.searchInput} style={{ marginTop: 12 }} type="search" placeholder="Search fields" value={search} onChange={event => setSearch(event.target.value)}/></div><div className={s.fieldList}>{data.filterOptions.fields.filter(item => item.name.toLowerCase().includes(search.toLowerCase())).map(item => <button key={item.id} className={`${s.fieldButton} ${field?.id === item.id ? s.fieldSelected : ""}`} onClick={() => selectField(item.id)} aria-pressed={field?.id === item.id}><div><strong>{item.name}</strong><small>{data.logs.filter(log => log.field.id === item.id).length} activity log</small></div><ChevronRight size={15}/></button>)}</div>{!data.filterOptions.fields.some(item => item.name.toLowerCase().includes(search.toLowerCase())) && <EmptyState title="No matching fields"/>}</Panel>
      <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}><Panel><div className={`${s.panelBody} ${mapStyles.detailRight}`}>{renderMap()}<button type="button" className={mapStyles.detailButton} disabled={!image} onClick={() => setExpanded(true)}><Expand size={16}/><span>Expand Map</span></button></div></Panel>
      {field && <Panel><FieldTimeline key={field.id} field={field} fields={data.filterOptions.fields} /></Panel>}
      <Panel><div className={s.detailsGrid}><div><span>ACTIVITY LOGS</span><strong>{logs.length}</strong></div><div><span>LOGGED HOURS</span><strong>{hours.toFixed(1)} h</strong></div><div><span>LATEST ACTIVITY</span><strong>{logs.at(-1)?.activity ?? "No activity"}</strong></div></div><div className={s.smallList}>{logs.map(log => <Link key={log.id} href={`/activity-logs?log=${log.id}`}><div><strong>{log.activity} · {log.employee.name}</strong><p>{formatDate(log.date)}</p></div><ArrowUpRight size={16}/></Link>)}</div></Panel></div>
    </div>{expanded && <Modal wide title={field?.name ?? "Field map"} onClose={() => setExpanded(false)}>{renderMap()}</Modal>}
  </div>;
}

export function SettingsPage() {
  const { workspace, update, saving, notify } = useWorkspace();
  const [draft, setDraft] = useState<WorkspaceSettings>(() => structuredClone(workspace.settings));
  const [error, setError] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPhotoBusy(true); setError("");
    try {
      if (!/^(image\/jpeg|image\/png|image\/webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) throw new Error("Choose a JPG, PNG, or WebP under 10 MB.");
      const bitmap = await createImageBitmap(file);
      try {
        const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Could not open this photo.");
        const side = Math.min(bitmap.width, bitmap.height);
        context.fillStyle = "#fff"; context.fillRect(0, 0, 256, 256);
        context.drawImage(bitmap, (bitmap.width-side)/2, (bitmap.height-side)/2, side, side, 0, 0, 256, 256);
        const adminAvatar = canvas.toDataURL("image/jpeg", .85);
        if (adminAvatar.length > 150000) throw new Error("Choose a smaller photo.");
        setDraft(previous => ({ ...previous, adminAvatar }));
      } finally { bitmap.close(); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not open this photo."); }
    finally { setPhotoBusy(false); event.target.value = ""; }
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(workspace.settings);
  async function save(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!draft.farmName.trim() || !draft.contactName.trim()) { setError("Enter a farm name and administrator name."); return; }
    if (await update("settings", { ...draft, farmName: draft.farmName.trim(), contactName: draft.contactName.trim(), email: draft.email.trim() })) notify("Your farm settings have been saved.");
  }
  return <div className={s.page}><PageHeader title="Settings" ><Badge tone="green">Farm workspace</Badge></PageHeader>
    <form onSubmit={save} className={s.settingsGrid}><Panel><div className={s.panelHeading}><div><h2>Farm profile</h2></div><Settings2 size={18} color="#888"/></div><div className={`${s.panelBody} ${s.form}`}><div className={s.adminPhoto}><img src={draft.adminAvatar ?? "/assets/avatar-default.svg"} alt="Administrator photo"/><input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={event => void uploadPhoto(event)} /><button type="button" className={s.secondaryButton} disabled={saving || photoBusy} onClick={() => photoInput.current?.click()}>{photoBusy ? "Opening…" : "Upload photo"}</button>{draft.adminAvatar && <button type="button" className={s.textButton} disabled={saving || photoBusy} onClick={() => setDraft(previous => ({ ...previous, adminAvatar: null }))}>Remove photo</button>}</div><div className={s.formGrid}><label>Farm name<input required maxLength={100} value={draft.farmName} onChange={event => setDraft({ ...draft, farmName: event.target.value })}/></label><label>Administrator name<input required maxLength={100} value={draft.contactName} onChange={event => setDraft({ ...draft, contactName: event.target.value })}/></label></div><label>Contact email<input type="email" maxLength={254} value={draft.email} onChange={event => setDraft({ ...draft, email: event.target.value })}/></label><FilterSelect label="Display timezone" value={draft.timezone} options={Array.from(new Set([draft.timezone, "America/Los_Angeles","America/Denver","America/Chicago","America/New_York","Europe/London","UTC"])).map(zone => ({ value: zone, label: zone }))} onChange={timezone => setDraft({ ...draft, timezone })} /><InviteCode compact /><Link className={s.textButton} href="/onboarding" style={{ alignSelf: "flex-start" }}>Manage fields <ArrowUpRight size={14}/></Link>{error && <p className={s.formError} role="alert">{error}</p>}<div className={s.formActions}><button type="button" className={s.secondaryButton} disabled={!dirty || saving || photoBusy} onClick={() => { setDraft(structuredClone(workspace.settings)); setError(""); }}>Discard changes</button><Button type="submit" disabled={!dirty || saving || photoBusy}>{saving ? "Saving…" : "Save changes"}</Button></div></div></Panel>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}><Panel><div className={s.panelHeading}><div><h2>Notification preferences</h2></div></div><div className={s.panelBody}>{([
        ["recordings", "New recordings"], ["weekly", "Weekly summary"], ["reminders", "Schedule reminders"],
      ] as const).map(([key,title]) => <label key={key} className={s.toggleRow}><div><strong>{title}</strong></div><input type="checkbox" className={s.toggle} aria-label={title} checked={draft.notifications[key]} onChange={event => setDraft({ ...draft, notifications: { ...draft.notifications, [key]: event.target.checked } })}/></label>)}</div></Panel></div>
    </form>
  </div>;
}

const helpArticles = [
  { title: "How do I review a worker’s activity?", body: "Open Activity Logs and select a row or its View button. You’ll see the activity summary, attached recording when available, field map, and tags. Use search, Sort, or Filter to narrow the list.", href: "/activity-logs", label: "Open activity logs" },
  { title: "How do tags and audit reviews work?", body: "Add a tag from an expanded activity log to organize your records. In Audit Manager, review the details and approve or flag an entry with a note. Tags and review decisions are saved in the database.", href: "/audit-manager", label: "Open audit manager" },
  { title: "Can I export my farm records?", body: "Reports creates CSV files for activities, compliance reviews, or logged work hours. Choose your date range, generate a report, and open the downloaded file in your spreadsheet app.", href: "/reports", label: "Create a report" },
  { title: "How do I assign work to my team?", body: "Go to Schedule, create an assignment, and select an employee, field, date, and time. You can edit or complete an assignment from either the calendar or the list.", href: "/schedule", label: "Open schedule" },
  { title: "Why do these records show April 2026?", body: "The initial farm records preserve the April 2026 dates from the original design. New logs use the work date you choose. Performance calculates hours from the stored logs.", href: "/performance", label: "View performance" },
  { title: "Does switching users change access permissions?", body: "Each account belongs to one farm. Switch User signs you in to another farm’s account with its name and password, and signs this browser out of the current farm.", href: "/switch-user", label: "Switch User" },
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
  return <div className={s.page}><PageHeader title="Support"><Button onClick={() => { setError(""); setCreating(true); }}><Plus size={15}/>Create request</Button></PageHeader>
    <div className={s.settingsGrid}><Panel><div className={s.panelHeading}><div><h2>How can we help?</h2><p>A quick guide to your Toph workspace.</p></div><LifeBuoy size={20} color="#888"/></div><div className={s.panelBody}><input className={s.searchInput} type="search" aria-label="Search help articles" placeholder="Search help articles" value={search} onChange={event => setSearch(event.target.value)}/>{articles.map(article => <details key={article.title} className={s.faq}><summary>{article.title}</summary><p>{article.body}</p><Link href={article.href} className={s.textButton} style={{ marginTop: 12 }}>{article.label}<ArrowUpRight size={14}/></Link></details>)}{!articles.length && <EmptyState title="No matching articles" description="Try searching for tags, reports, or scheduling."/>}</div></Panel>
      <Panel><div className={s.panelHeading}><div><h2>Your requests</h2><p>{workspace.tickets.filter(item => item.status === "Open").length} open requests</p></div></div>{workspace.tickets.length ? <div className={s.smallList}>{[...workspace.tickets].reverse().map(item => <button key={item.id} className={s.fieldButton} onClick={() => { setError(""); setSelected(item.id); }}><div><strong>{item.subject}</strong><small>{item.category} · {new Date(item.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</small></div><Badge tone={item.status === "Open" ? "amber" : "green"}>{item.status}</Badge></button>)}</div> : <EmptyState title="You’re all caught up" description="Your saved support requests will appear here."/>}<div className={s.panelBody}><p className={s.workspaceNote}>Requests stay in this farm workspace. They are not sent to an external support team.</p></div></Panel>
    </div>{creating && <Modal title="Create a support request" onClose={() => setCreating(false)}><form className={s.form} onSubmit={createTicket}><label>Subject<input required maxLength={160} value={subject} onChange={event => setSubject(event.target.value)} placeholder="What do you need help with?"/></label><label>Category<select value={category} onChange={event => setCategory(event.target.value as SupportTicket["category"])}><option>General</option><option>Technical</option><option>Account</option></select></label><label>Details<textarea required maxLength={4000} value={body} onChange={event => setBody(event.target.value)} placeholder="Tell us what happened and what you expected."/></label><p className={s.workspaceNote}>Saved to this workspace only. No external message is sent.</p>{error && <p className={s.formError} role="alert">{error}</p>}<div className={s.formActions}><Button secondary type="button" onClick={() => setCreating(false)}>Cancel</Button><Button disabled={saving} type="submit">{saving ? "Saving…" : "Save request"}</Button></div></form></Modal>}
    {ticket && <Modal title={ticket.subject} onClose={() => setSelected(null)}><Badge tone={ticket.status === "Open" ? "amber" : "green"}>{ticket.status}</Badge><p className={s.muted}>{ticket.category} · {new Date(ticket.createdAt).toLocaleDateString()}</p><p style={{ color: "#555", lineHeight: 1.7, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{ticket.body}</p>{error && <p className={s.formError} role="alert">{error}</p>}<div className={s.formActions}><Button secondary onClick={() => setSelected(null)}>Done</Button><Button disabled={saving} onClick={async () => { if (await update("tickets", previous => previous.map(item => item.id === ticket.id ? { ...item, status: item.status === "Open" ? "Closed" : "Open" } : item))) notify(ticket.status === "Open" ? "Request closed." : "Request reopened."); else setError("The status could not be saved. Please try again."); }}>{ticket.status === "Open" ? "Close request" : "Reopen request"}</Button></div></Modal>}
  </div>;
}
