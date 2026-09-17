/** Shared mobile API data. No database, React, or native imports. */
import type { LogDto } from "./dashboard";

export type MobileAccount = {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  avatarUrl: string | null;
  defaultField: string;
  defaultActivity: string;
};
export type MobileAccountEdit = Omit<MobileAccount, "id">;
export type MobileBootstrap = {
  mode: "shared";
  farm: { id: string; name: string; timezone: string };
  accounts: MobileAccount[];
  fields: { id: string; name: string }[];
  revision: number;
  maxAudioBytes: number;
};
export type MobileLogSubmission = {
  contractVersion: "1";
  clientDraftId: string;
  accountId: string;
  fieldId: string;
  activity: string;
  /** Farm-local date and wall times; never converted using the phone timezone. */
  workDate: string;
  startTime: string;
  endTime: string;
  notes: string;
  transcript: string | null;
  treatment: { product: string | null; amount: number | null; unit: string | null } | null;
  tags: string[];
  recordings: { mimeType: string; durationSeconds: number }[];
};
export type MobileLogReceipt = { clientDraftId: string; logId: string; savedAt: string };
export type MobileLogResponse = { data: MobileLogReceipt };
export type MobileRemoteLog = LogDto & {
  clientDraftId: string | null;
  notes: string;
  transcript: string | null;
  treatment: MobileLogSubmission["treatment"];
  clips: { url: string; durationSeconds: number; mimeType: string }[];
};
