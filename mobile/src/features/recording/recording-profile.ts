/** Settings for the local phone app, separate from server identity/auth. */
import { File, Paths } from "expo-file-system";
import { storageDirectoryName } from "./local-drafts";
import { workActivities } from "@toph/contracts/recording";

export const fields = "ABCDEFGHIJK".split("").map((letter) => `FIELD ${letter}`);
export const activities: string[] = [...workActivities];
export type RecordingProfile = { name: string; defaultField: string; defaultActivity: string };
export const defaultProfile: RecordingProfile = { name: "Isaac Wang", defaultField: "FIELD A", defaultActivity: "Spraying" };

const profileFile = () => new File(Paths.document, storageDirectoryName, "profile.json");

export function normalizeProfile(value: unknown): RecordingProfile {
  const candidate = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim().slice(0, 80) : defaultProfile.name,
    defaultField: typeof candidate.defaultField === "string" && fields.includes(candidate.defaultField) ? candidate.defaultField : defaultProfile.defaultField,
    defaultActivity: typeof candidate.defaultActivity === "string" && activities.includes(candidate.defaultActivity) ? candidate.defaultActivity : defaultProfile.defaultActivity,
  };
}

export function isValidProfile(profile: RecordingProfile) {
  const name = profile.name.trim();
  return Boolean(name) && name.length <= 80 && fields.includes(profile.defaultField) && activities.includes(profile.defaultActivity);
}

export function readProfile(): RecordingProfile {
  const file = profileFile();
  if (!file.exists) return defaultProfile;
  try {
    return normalizeProfile(JSON.parse(file.textSync()));
  } catch {
    return defaultProfile;
  }
}

export function saveProfile(profile: RecordingProfile) {
  if (!isValidProfile(profile)) throw new Error("Check your name and recording defaults.");
  try {
    const file = profileFile();
    const directory = file.parentDirectory;
    if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
    if (!file.exists) file.create();
    file.write(JSON.stringify({ ...profile, name: profile.name.trim() }));
  } catch {
    throw new Error("Your changes could not be saved. Please try again.");
  }
}
