/**
 * Bays Ranch initial dataset: the farm, its eleven employees, eleven fields, and eleven work
 * logs loaded by `npm run db:seed`. IDs are deterministic so the same records exist after every
 * run; the seed only inserts what is missing.
 */

export const FARM_ID = "00000000-0000-4000-8000-000000000001";

export const FARM = {
  id: FARM_ID,
  name: "Bays Ranch",
  avatarPath: "/assets/avatar.jpg",
  timezone: "America/Los_Angeles",
} as const;

export const RECORDING = {
  path: "/assets/sample-recording.mp3",
  /** Container duration read with `ffprobe -show_entries format=duration`. */
  durationSeconds: 13.384671,
  waveformAssetPath: "/assets/waveform.svg",
} as const;

/** Isaac's guided voice-log summary, stored verbatim (leading quote, no trailing quote). */
export const ISAAC_SUMMARY =
  "\"Offline guided voice log created at 2026-04-08T22:01:01.711Z. Question (activity_type): What type of activity was this — spraying, fertilizing, planting, irrigating, harvesting, scouting, pruning, soil work, or equipment maintenance? Answer: I'm leaving first, I'm going to go home. Question (field_block): Where were you working (field, block, or area)? Answer: yes, in one part and then 130 and 200 yes, and 130 for uh 160 and no, this yes no, no, uhm no no I remember, uhm uhm uhm, no, I don't remember anything.";

export type InitialRow = {
  n: number;
  employee: string;
  activity: string;
  workDate: string;
  field: string;
  /** Farm-local wall clock, HH:MM. */
  start: string;
  end: string;
  isNew: boolean;
  summary: string;
};

export const INITIAL_ROWS: readonly InitialRow[] = [
  { n: 1, employee: "Isaac Wang", activity: "Spraying", workDate: "2026-04-19", field: "FIELD A", start: "06:00", end: "10:40", isNew: true, summary: ISAAC_SUMMARY },
  { n: 2, employee: "Maya Patel", activity: "Harvesting", workDate: "2026-04-20", field: "FIELD B", start: "07:30", end: "11:15", isNew: true, summary: "Harvested the east rows of FIELD B from 7:30 to 11:15. Crates were stacked at the north gate for pickup; no equipment issues." },
  { n: 3, employee: "Liam Johnson", activity: "Planting", workDate: "2026-04-21", field: "FIELD C", start: "08:00", end: "12:00", isNew: true, summary: "Planted FIELD C between 8:00 and 12:00. Finished the planned rows and flagged the low corner for drainage before the next pass." },
  { n: 4, employee: "Sophia Lee", activity: "Irrigation", workDate: "2026-04-22", field: "FIELD D", start: "06:30", end: "09:30", isNew: true, summary: "Ran irrigation on FIELD D from 6:30 to 9:30. Checked the drip lines along the west edge and cleared two blocked emitters." },
  { n: 5, employee: "Ethan Kim", activity: "Fertilizing", workDate: "2026-04-23", field: "FIELD E", start: "05:45", end: "09:00", isNew: false, summary: "Fertilized FIELD E from 5:45 to 9:00 following the field plan. Covered the full block before the wind picked up mid-morning." },
  { n: 6, employee: "Olivia Martinez", activity: "Weeding", workDate: "2026-04-24", field: "FIELD F", start: "06:15", end: "10:00", isNew: false, summary: "Weeded FIELD F from 6:15 to 10:00. The south half is clear; the north half needs one more pass later this week." },
  { n: 7, employee: "Noah Brown", activity: "Pruning", workDate: "2026-04-25", field: "FIELD G", start: "07:00", end: "11:30", isNew: false, summary: "Pruned FIELD G between 7:00 and 11:30. Cuttings were collected at the end of each row for pickup." },
  { n: 8, employee: "Emma Davis", activity: "Monitoring", workDate: "2026-04-26", field: "FIELD H", start: "08:15", end: "12:45", isNew: false, summary: "Walked FIELD H from 8:15 to 12:45 checking plant condition and moisture. Nothing unusual to report." },
  { n: 9, employee: "James Wilson", activity: "Soil Testing", workDate: "2026-04-27", field: "FIELD I", start: "06:00", end: "09:00", isNew: false, summary: "Collected soil samples across FIELD I from 6:00 to 9:00, one per grid square. Samples are labeled and ready to send out." },
  { n: 10, employee: "Isabella Garcia", activity: "Seeding", workDate: "2026-04-28", field: "FIELD J", start: "07:45", end: "11:00", isNew: false, summary: "Seeded FIELD J from 7:45 to 11:00. Completed all rows and refilled the seeder twice." },
  { n: 11, employee: "Benjamin Moore", activity: "Pest Control", workDate: "2026-04-29", field: "FIELD K", start: "06:30", end: "10:30", isNew: false, summary: "Pest control pass on FIELD K from 6:30 to 10:30. Treated the perimeter rows first and finished the interior before the heat." },
];

/** The farm administrator is a separate account, not an extra employee profile. */
export const INITIAL_EMPLOYEES = INITIAL_ROWS.map((row) => ({ n: row.n, name: row.employee }));

export type RecordKind = "employee" | "field" | "workLog";

const ID_PREFIX: Record<RecordKind, string> = {
  employee: "10000000",
  field: "20000000",
  workLog: "30000000",
};

/** Deterministic ID for row N: prefix-0000-4000-8000-<N zero-padded to 12 digits>. */
export function recordId(kind: RecordKind, n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 999_999_999_999) throw new Error(`Invalid row number: ${n}`);
  return `${ID_PREFIX[kind]}-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export const ISAAC_LOG_ID = recordId("workLog", 1);
