"use client";
import { useRouter, useSearchParams } from "next/navigation";
import type { AskFarmResponse } from "@/contracts/ask";
import type { LogTagsResponse } from "@/contracts/dashboard";
import type { DashboardData } from "@/components/dashboard/types";
import { Dashboard } from "@/components/dashboard/dashboard";
import { requestJson, useWorkspace } from "./workspace-provider";

export function DashboardPage({ activityPage = false }: { activityPage?: boolean }) {
  const { data, workspace, setLogTags, markReviewed } = useWorkspace();
  const router = useRouter(); const search = useSearchParams();
  const adapted: DashboardData = {
    farm: { ...data.farm, role: "Admin", name: workspace.settings.farmName, avatarUrl: workspace.settings.adminAvatar ?? "/assets/avatar-default.svg" },
    metrics: data.metrics,
    fields: data.filterOptions.fields.map(field => ({ ...field, mapImageUrl: field.mapImageUrl ?? "" })),
    logs: data.logs.map(log => ({ ...log, field: { ...log.field, mapImageUrl: log.field.mapImageUrl ?? "" }, tags: log.tags.map(tag => tag.label), recording: log.recording ? { url: log.recording.url, durationSeconds: log.recording.durationSeconds ?? 0, clips: log.recording.clips } : { url: "", durationSeconds: 0 } })),
  };
  async function addTag(logId: string, label: string) {
    const result = await requestJson<LogTagsResponse>(`/api/logs/${logId}/tags`, { method: "POST", body: JSON.stringify({ label }) });
    setLogTags(logId, result.data.tags); return result.data.tags.map(tag => tag.label);
  }
  async function removeTag(logId: string, label: string) {
    const tag = data.logs.find(log => log.id === logId)?.tags.find(tag => tag.label === label);
    if (!tag) throw new Error("The tag could not be found. Refresh the page and try again.");
    const result = await requestJson<LogTagsResponse>(`/api/logs/${logId}/tags/${tag.id}`, { method: "DELETE" });
    setLogTags(logId, result.data.tags); return result.data.tags.map(tag => tag.label);
  }
  async function askFarm(question: string, signal: AbortSignal) {
    const result = await requestJson<AskFarmResponse>("/api/logs/ask", { method: "POST", body: JSON.stringify({ question }), signal });
    return result.data;
  }
  return <Dashboard embedded reviewMode onReview={markReviewed} activityPage={activityPage} data={adapted} initialExpandedId={search.get("log")} onAddTag={addTag} onRemoveTag={removeTag} onNavigate={path => router.push(path)} onAsk={activityPage ? askFarm : undefined} />;
}
