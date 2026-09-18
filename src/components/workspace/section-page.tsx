"use client";
import { SwitchUserPage } from "../accounts/account-page";
import { DashboardPage } from "./dashboard-page";
import { MapPage, SettingsPage, SupportPage } from "./general-pages";
import { AuditPage, SchedulePage } from "./operations-pages";
import { ReportsPage } from "./reports-page";
import { EmployeesPage, PerformancePage, MessagesPage } from "./team-pages";
export function SectionPage({ section }: { section: string }) {
  switch (section) {
    case "activity-logs": return <DashboardPage activityPage/>;
    case "map": return <MapPage/>;
    case "audit-manager": return <AuditPage/>;
    case "reports": return <ReportsPage/>;
    case "schedule": return <SchedulePage/>;
    case "employees": return <EmployeesPage/>;
    case "performance": return <PerformancePage/>;
    case "messages": return <MessagesPage/>;
    case "settings": return <SettingsPage/>;
    case "support": return <SupportPage/>;
    case "switch-user": return <SwitchUserPage/>;
    default: return null;
  }
}
