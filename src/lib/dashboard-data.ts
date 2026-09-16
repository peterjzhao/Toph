export type EmployeeLog = {
  id: string;
  employee: { id: string; name: string };
  activity: string;
  date: string;
  field: { id: string; name: string; mapImageUrl: string };
  startAt: string;
  endAt: string;
  summary: string;
  recording: { url: string; durationSeconds: number; isSample: boolean };
  tags: string[];
  isNew: boolean;
};

export type DashboardData = {
  farm: { id: string; name: string; role: string; avatarUrl: string; timezone?: string };
  metrics: { recordingsToday: number; newRecordings: number; activeWorkers: number; responseAccuracy: number | null };
  logs: EmployeeLog[];
};

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

// Reference fixtures for the frontend milestone. Replace this source with a
// server-side database query without changing the DashboardData contract.
export const dashboardData: DashboardData = {
  farm: { id: "bays-ranch", name: "Bays Ranch", role: "Admin", avatarUrl: "/assets/avatar.jpg" },
  metrics: { recordingsToday: 5, newRecordings: 1, activeWorkers: 12, responseAccuracy: 90 },
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
      recording: { url: "/assets/sample-recording.mp3", durationSeconds: 13.384671, isSample: true },
      tags: [],
      isNew: index < 4,
    };
  }),
};

export function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

export function formatTime(value: string, timezone = "America/Los_Angeles") {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(value));
}
