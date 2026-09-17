/** The Hands-free switch is remembered on the device, beside the drafts. */
import { File, Paths } from "expo-file-system";
import { storageDirectoryName } from "../local-drafts";

const preferenceFile = () => new File(Paths.document, storageDirectoryName, "hands-free.json");

export function readHandsFreePreference(): boolean {
  try {
    const file = preferenceFile();
    return file.exists && (JSON.parse(file.textSync()) as { enabled?: unknown }).enabled === true;
  } catch { return false; }
}

/** A failed write only means the switch resets on the next launch. */
export function saveHandsFreePreference(enabled: boolean) {
  try {
    const file = preferenceFile();
    if (!file.parentDirectory.exists) file.parentDirectory.create({ intermediates: true, idempotent: true });
    if (!file.exists) file.create();
    file.write(JSON.stringify({ enabled }));
  } catch { /* keep the in-memory value */ }
}
