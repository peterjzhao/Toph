/** Shared farm demo profiles, not production authentication. Browser/native safe. */
import type { LogDto } from "./dashboard";
import type { MobileLogReceipt, MobileLogSubmission } from "./mobile";

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
  mode: "demo";
  farm: { id: string; name: string; timezone: string };
  accounts: MobileAccount[];
  fields: { id: string; name: string }[];
  revision: number;
  maxAudioBytes: number;
};
export type MobileDemoSubmission = Omit<MobileLogSubmission, "contractVersion" | "recording"> & {
  contractVersion: "demo-1";
  accountId: string;
  recordings: { mimeType: string; durationSeconds: number }[];
};
export type MobileRemoteLog = LogDto & {
  clientDraftId: string | null;
  notes: string;
  transcript: string | null;
  treatment: MobileLogSubmission["treatment"];
  clips: { url: string; durationSeconds: number; mimeType: string }[];
};
export type MobileDemoReceipt = MobileLogReceipt;
