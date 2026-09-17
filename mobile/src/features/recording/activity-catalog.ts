import { File, Paths } from "expo-file-system";
import { storageDirectoryName } from "./local-drafts";

const catalogFile = (scope?: string) => new File(Paths.document, storageDirectoryName, scope ? `activity-items-${encodeURIComponent(scope)}.json` : "activity-items.json");
type Catalog = Record<string, string[]>;

function readCatalog(scope?: string): Catalog {
  const file = catalogFile(scope);
  if (!file.exists) return {};
  const value: unknown = JSON.parse(file.textSync());
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid catalog");
  return Object.fromEntries(Object.entries(value).map(([key, items]) => {
    if (!Array.isArray(items) || !items.every(item => typeof item === "string")) throw new Error("Invalid catalog");
    return [key, items];
  }));
}

export function readActivityItems(activity: string, scope?: string): string[] {
  try { return readCatalog(scope)[activity] ?? []; }
  catch { throw new Error("Saved choices could not be loaded."); }
}

/** Signed-in choices are scoped to the farm and account, as well as the activity. */
export function saveActivityItem(activity: string, input: string, scope?: string): string {
  const item = input.trim().replace(/\s+/g, " ");
  if (!item || item.length > 120) throw new Error("Enter a name of up to 120 characters.");
  try {
    const catalog = readCatalog(scope);
    const items = catalog[activity] ?? [];
    const existing = items.find(value => value.toLowerCase() === item.toLowerCase());
    if (existing) return existing;
    const file = catalogFile(scope);
    if (!file.parentDirectory.exists) file.parentDirectory.create({ intermediates: true, idempotent: true });
    if (!file.exists) file.create();
    file.write(JSON.stringify({ ...catalog, [activity]: [...items, item].sort((a, b) => a.localeCompare(b)) }));
    return item;
  } catch { throw new Error("This choice could not be saved on your device."); }
}
