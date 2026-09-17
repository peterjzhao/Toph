"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useWorkspace } from "./workspace-provider";
import d from "../dashboard/dashboard.module.css";
import s from "./workspace.module.css";
const groups = [
  { label: "OVERVIEW", items: [["Dashboard", "/", "chart-line"], ["Activity Logs", "/activity-logs", "audio-lines"], ["Map", "/map", "map"]] },
  { label: "COMPLIANCE", items: [["Audit Manager", "/audit-manager", "book-check"], ["Reports", "/reports", "files"], ["Schedule", "/schedule", "calendar"]] },
  { label: "TEAM MANAGEMENT", items: [["Employees", "/employees", "users"], ["Performance", "/performance", "chart-pie"], ["Messages", "/messages", "mail"]] },
  { label: "OTHER", items: [["Settings", "/settings", "cog"], ["Support", "/support", "handshake"]] },
];
function Icon({ name, size = 16 }: { name: string; size?: number }) { return <img alt="" aria-hidden width={size} height={size} src={`/assets/icons/${name}.svg`} style={{ flexShrink: 0 }} />; }
export function WorkspaceShell({ children }: { children: ReactNode }) {
  const { data, workspace, session, signOut, saveError, notice } = useWorkspace();
  const path = usePathname();
  useEffect(() => { document.getElementById("dashboard-content")?.scrollTo({ top: 0 }); }, [path]);
  if (!session) return null;
  const unread = workspace.messages.filter(message => message.from === "employee" && !message.read).length;
  return <div className={d.app}>
    <a className={d.skipLink} href="#dashboard-content">Skip to content</a>
    <aside className={`${d.sidebar} ${s.sidebarFrame}`} aria-label="Farm navigation">
      <div className={d.profile}>
        <Link href="/settings" className={d.profileIdentity} style={{ color: "inherit", textDecoration: "none" }} aria-label="Farm profile">
          <div className={d.avatar}>{session.role === "admin" ? <img src={workspace.settings.adminAvatar ?? "/assets/avatar-default.svg"} alt={`${data.farm.name} administrator`}/> : <span className={s.initials}>{session.name.split(" ").map(word => word[0]).join("").slice(0,2)}</span>}</div>
          <div className={d.profileText}><span className={d.farmName}>{workspace.settings.farmName}</span><span className={d.role}><Icon name="user-star" size={10}/><span>{session.role === "admin" ? "Admin" : session.name.split(" ")[0]}</span></span></div>
        </Link>
        <Link href="/messages" className={d.inboxButton} aria-label={`Inbox${unread ? `, ${unread} unread messages` : ""}`}><Icon name="inbox"/></Link>
      </div>
      {groups.map(group => <nav key={group.label} aria-label={group.label} className={`${d.navGroup} ${group.label === "OTHER" ? d.otherGroup : ""}`}><div className={d.navGroupLabel}>{group.label}</div>{group.items.map(([name,href,icon]) => <Link href={href} key={href} aria-label={name} title={name} aria-current={path === href ? "page" : undefined} className={`${d.navItem} ${path === href ? d.activeNav : ""}`} style={{ textDecoration: "none", color: "inherit" }}><Icon name={icon}/><span>{name}</span>{name === "Dashboard" && <span className={d.navBadge}>1</span>}{name === "Messages" && unread > 0 && path !== "/" && <span className={d.navBadge}>{unread}</span>}</Link>)}</nav>)}
      <Link href="/switch-user" aria-current={path === "/switch-user" ? "page" : undefined} className={`${d.navItem} ${path === "/switch-user" ? d.activeNav : ""}`} aria-label="Switch User" title="Switch User" style={{ color: "inherit", textDecoration: "none" }}><Icon name="arrow-right-left"/><span>Switch User</span></Link>
      <button type="button" className={d.navItem} aria-label="Log Out" title="Log Out" onClick={() => void signOut()}><Icon name="log-out"/><span>Log Out</span></button>
    </aside>
    <main id="dashboard-content" className={d.main}>
      {saveError && <div className={s.errorBanner} role="alert" style={{ marginTop: 10 }}>{saveError}</div>}
      {children}
    </main>
    {notice && <div role="status" className={s.notice}>{notice}</div>}
  </div>;
}
