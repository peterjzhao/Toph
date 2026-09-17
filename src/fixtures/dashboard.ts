import type { DashboardData } from "@/components/dashboard/types";
import { formatTime } from "@/lib/format";

const sourceSummary = '"Offline guided voice log created at 2026-04-08T22:01:01.711Z. Question (activity_type): What type of activity was this — spraying, fertilizing, planting, irrigating, harvesting, scouting, pruning, soil work, or equipment maintenance? Answer: I\'m leaving first, I\'m going to go home. Question (field_block): Where were you working (field, block, or area)? Answer: yes, in one part and then 130 and 200 yes, and 130 for uh 160 and no, this yes no, no, uhm no no I remember, uhm uhm uhm, no, I don\'t remember anything.';

const entries = [
  ["Isaac Wang", "Spraying", "06:00", "10:40"],
  ["Maya Patel", "Harvesting", "07:30", "11:15"],
  ["Liam Johnson", "Planting", "08:00", "12:00"],
  ["Sophia Lee", "Irrigation", "06:30", "09:30"],
  ["Ethan Kim", "Fertilizing", "05:45", "09:00"],
  ["Olivia Martinez", "Weeding", "06:15", "10:00"],
  ["Noah Brown", "Pruning", "07:00", "11:30"],
  ["Emma Davis", "Monitoring", "08:15", "12:45"],
  ["James Wilson", "Soil Testing", "06:00", "09:00"],
  ["Isabella Garcia", "Seeding", "07:45", "11:00"],
  ["Benjamin Moore", "Pest Control", "06:30", "10:30"],
] as const;

// Figma reference data used only by the development-only /design-check page.
export const dashboardData: DashboardData = {
  farm: { id: "bays-ranch", name: "Bays Ranch", role: "Admin", avatarUrl: "/assets/avatar.jpg" },
  metrics: { recordingsToday: 5, newRecordings: 1, activeWorkers: 12, responseAccuracy: 90, asOf: "2026-04-29" },
  logs: entries.map(([name, activity, start, end], index) => {
    const date = `2026-04-${19 + index}`;
    const field = `FIELD ${String.fromCharCode(65 + index)}`;
    return {
      id: `log-${index + 1}`,
      employee: { id: `employee-${index + 1}`, name },
      activity,
      date,
      field: { id: `field-${index + 1}`, name: field, mapImageUrl: "/assets/field-map.svg" },
      startAt: `${date}T${start}:00-07:00`,
      endAt: `${date}T${end}:00-07:00`,
      summary: index === 0 ? sourceSummary : `${name} recorded ${activity.toLowerCase()} in ${field}. Work began at ${formatTime(`${date}T${start}:00-07:00`)} and finished at ${formatTime(`${date}T${end}:00-07:00`)}. This is a sample log for the dashboard preview.`,
      recording: { url: "/assets/sample-recording.mp3", durationSeconds: 13.384671 },
      tags: [],
      isNew: index < 4,
    };
  }),
};
