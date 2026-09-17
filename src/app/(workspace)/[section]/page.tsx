import { Suspense } from "react";
import { notFound } from "next/navigation";
import { SectionPage } from "@/components/workspace/section-page";
const titles: Record<string,string> = { "activity-logs":"Activity Logs", map:"Map", "audit-manager":"Audit Manager", reports:"Reports", schedule:"Schedule", employees:"Employees", performance:"Performance", messages:"Messages", settings:"Settings", support:"Support", "switch-user":"Account", account:"Account" };
export async function generateMetadata({ params }: { params: Promise<{ section: string }> }) { const { section } = await params; return { title: `${titles[section] ?? "Page not found"} · Toph` }; }
export default async function Page({ params }: { params: Promise<{ section: string }> }) { const { section } = await params; if (!titles[section]) notFound(); return <Suspense><SectionPage section={section}/></Suspense>; }
