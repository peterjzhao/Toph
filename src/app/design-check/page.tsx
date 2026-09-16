import { notFound } from "next/navigation";
import { Dashboard } from "@/components/dashboard";
import { dashboardData } from "@/lib/dashboard-data";

// Local-only overlay of the actual supplied Figma export, for visual review.
export default async function DesignCheck({ searchParams }: { searchParams: Promise<{ view?: string; overlay?: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const params = await searchParams;
  const view = params.view === "expanded" ? "expanded" : "default";
  return <>
    <Dashboard data={dashboardData} initialExpandedId={view === "expanded" ? "log-1" : null} />
    {params.overlay !== "off" && <img src={`/design-reference/${view}`} alt="" aria-hidden="true" style={{ position: "fixed", inset: 0, width: 1676, height: 955, pointerEvents: "none", zIndex: 100, mixBlendMode: "difference" }} />}
  </>;
}
