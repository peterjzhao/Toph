/** Pure helpers shared by the recording screens. */
import type { RecordingDraft } from "./local-drafts";
import { treatmentActivities as sharedTreatmentActivities, treatmentUnits, workTags } from "@toph/contracts/recording";

export type WorkDetails = Pick<RecordingDraft, "field" | "activity" | "workDate" | "startTime" | "endTime" | "notes" | "product" | "amount" | "unit" | "tags">;

export const suggestedTags: string[] = [...workTags];
export const unitOptions: string[] = [...treatmentUnits];
export const treatmentActivities: string[] = [...sharedTreatmentActivities];
export const emptyDetails: WorkDetails = { field: "FIELD A", activity: "Spraying", workDate: "", startTime: "", endTime: "", notes: "", product: "", amount: "", unit: "L", tags: [] };
export const sampleDetails: WorkDetails = {
  ...emptyDetails, workDate: "2026-04-19", startTime: "06:00", endTime: "10:40",
  notes: "Completed the scheduled spraying in Field A from 6:00 AM to 10:40 AM. Checked the equipment and logged the work before leaving the field.",
};

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (value: number) => String(value).padStart(2, "0");

export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function clock(seconds: number) {
  return `${pad(Math.floor(seconds / 60))}:${pad(Math.floor(seconds % 60))}`;
}

export function dateLabel(date: string) {
  if (!date) return "New work log";
  const [year, month, day] = date.split("-").map(Number);
  return `${months[month - 1]} ${day}, ${year}`;
}

export function fieldLabel(field: string) {
  return field.startsWith("FIELD ") ? `Field ${field.slice(6)}` : field;
}

export function isTreatment(activity: string) {
  return treatmentActivities.includes(activity);
}

/** Matches the placeholder and value text of a browser `<input type="date">`. */
export function dateInputLabel(date: string) {
  if (!date) return "mm/dd/yyyy";
  const [year, month, day] = date.split("-");
  return `${month}/${day}/${year}`;
}

/** Matches the placeholder and value text of a browser `<input type="time">`. */
export function timeInputLabel(time: string) {
  if (!time) return "--:-- --";
  const [hours, minutes] = time.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  const twelveHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${pad(twelveHour)}:${pad(minutes)} ${suffix}`;
}

export function toDate(date: string, time = "") {
  const [year, month, day] = date ? date.split("-").map(Number) : [NaN, NaN, NaN];
  const [hours, minutes] = time ? time.split(":").map(Number) : [12, 0];
  const now = new Date();
  return new Date(
    Number.isFinite(year) ? year : now.getFullYear(),
    Number.isFinite(month) ? month - 1 : now.getMonth(),
    Number.isFinite(day) ? day : now.getDate(),
    hours, minutes, 0, 0,
  );
}

export function fromDate(date: Date) {
  return localDate(date);
}

export function fromTime(date: Date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function audioFileName(workDate: string, extension: string) {
  return `toph-${workDate || "draft"}.${extension}`;
}

/** Returns an error message, or an empty string when the log can be saved. */
export function validateDetails(details: WorkDetails, hasAudio: boolean) {
  if (!details.workDate || !details.startTime || !details.endTime) return "Fill in the date, start time, and end time.";
  if (details.endTime <= details.startTime) return "End time must be later than start time for this work date.";
  if (!hasAudio && !details.notes.trim()) return "Add a short note or a recording before saving.";
  if (details.amount && (!Number.isFinite(Number(details.amount)) || Number(details.amount) <= 0)) return "Enter an amount greater than zero, or leave it blank.";
  return "";
}
