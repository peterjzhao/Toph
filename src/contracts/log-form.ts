/**
 * The single definition of what a work log collects beyond its fixed core (field, activity,
 * date, times, notes, tags). Everything else derives from this module: the native form, the AI
 * extraction schema and prompt, submission validation, the stored `work_logs.details` object,
 * and dashboard corrections. Add or change a field here and every layer follows.
 *
 * Pure TypeScript with no imports, so web, native, and server code can all use it at runtime.
 */

export type LogFieldType = "text" | "number" | "select";
export type LogDetailValue = string | number | null;
/** Stored per log, keyed by `LogFieldDef.key`. Only keys with a value are kept. */
export type LogDetails = Record<string, string | number>;

export type LogFieldDef = {
  /** Stable storage key. One key always has one type, whichever activity uses it. */
  key: string;
  label: string;
  type: LogFieldType;
  /** Choices for a select. */
  options?: readonly string[];
  /** For a number: the select field holding its unit. A stated number needs its unit. */
  unitKey?: string;
  /** Tells the extraction model what belongs here. */
  hint?: string;
};

export type ActivityFormDef = {
  /** Label for the shared notes box. */
  notesLabel?: string;
  /** Collected unless the farm hides them. */
  defaults: readonly LogFieldDef[];
  /** Ready-made options a farm can switch on. */
  suggested: readonly LogFieldDef[];
};

const text = (key: string, label: string, hint?: string): LogFieldDef => ({ key, label, type: "text", ...(hint ? { hint } : {}) });
const number = (key: string, label: string, hint?: string): LogFieldDef => ({ key, label, type: "number", ...(hint ? { hint } : {}) });
const select = (key: string, label: string, options: readonly string[], hint?: string): LogFieldDef => ({ key, label, type: "select", options, ...(hint ? { hint } : {}) });
/** The activity's named item: product, crop, method, equipment, operation or test type. */
const item = (label: string) => text("product", label, "Free text; a new name does not need to match an existing choice.");
const quantity = (label: string, units: readonly string[]): LogFieldDef[] => [{ ...number("amount", label), unitKey: "unit" }, select("unit", "Unit", units)];

export const treatmentUnits = ["L", "mL", "kg", "g", "gal", "lb"] as const;

// Suggestions offered for every activity.
const area: LogFieldDef[] = [{ ...number("areaCovered", "Area covered"), unitKey: "areaUnit" }, select("areaUnit", "Area unit", ["acres", "ha", "rows"])];
const equipmentUsed = text("equipmentUsed", "Equipment used", "Vehicle, implement or tool used for the work.");
const crewSize = number("crewSize", "Crew size", "Number of people who did the work, including the speaker.");
const everywhere = [...area, equipmentUsed, crewSize];

// Application records for sprays and pest control.
const application: LogFieldDef[] = [
  select("applicationMethod", "Applied by", ["Truck", "Plane", "Tractor boom", "Backpack sprayer", "Drone", "Hand"]),
  text("targetPest", "Target pest or disease"),
  text("applicationRate", "Rate", "Rate as spoken, e.g. \"2 qt per acre\"."),
  text("epaRegNumber", "EPA registration no."),
  number("windSpeedMph", "Wind speed (mph)"),
  select("windDirection", "Wind direction", ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]),
  number("temperatureF", "Temperature (°F)"),
  text("applicatorLicense", "Applicator license"),
  number("reentryHours", "Re-entry interval (hours)", "Only when the speaker states it. Never look it up or infer it from the product."),
  number("preHarvestDays", "Pre-harvest interval (days)", "Only when the speaker states it. Never look it up or infer it from the product."),
];
const observation: LogFieldDef[] = [text("pestObserved", "Pest or disease seen"), select("severity", "Severity (1–5)", ["1", "2", "3", "4", "5"])];

export const logFormCatalog = {
  Spraying: { defaults: [item("Product"), ...quantity("Amount applied", treatmentUnits)], suggested: [...application, ...everywhere] },
  Fertilizing: { defaults: [item("Fertilizer"), ...quantity("Amount applied", ["kg", "g", "lb", "L", "mL", "gal"])],
    suggested: [select("applicationMethod", "Applied by", ["Broadcast", "Banded", "Fertigation", "Foliar", "Hand"]), text("applicationRate", "Rate", "Rate as spoken, e.g. \"50 lb per acre\"."), ...everywhere] },
  Planting: { defaults: [item("Crop / variety"), ...quantity("Plants planted", ["plants", "trays", "rows"])], suggested: everywhere },
  Irrigation: { notesLabel: "Observations", defaults: [item("Irrigation method")],
    suggested: [number("durationHours", "Run time (hours)"), text("waterSource", "Water source"), ...everywhere] },
  Harvesting: { defaults: [item("Crop / variety"), ...quantity("Yield", ["kg", "lb", "bins", "crates", "bunches"])],
    suggested: [text("qualityGrade", "Quality / grade"), text("destination", "Destination / buyer"), text("lotNumber", "Lot number"), ...everywhere] },
  Scouting: { notesLabel: "Observations", defaults: [], suggested: [...observation, ...everywhere] },
  Pruning: { notesLabel: "Work performed", defaults: [item("Crop / variety")], suggested: everywhere },
  "Soil work": { notesLabel: "Work performed", defaults: [item("Operation")], suggested: everywhere },
  "Equipment maintenance": { notesLabel: "Work performed", defaults: [item("Equipment")], suggested: [number("engineHours", "Engine hours"), crewSize] },
  Weeding: { notesLabel: "Work performed", defaults: [item("Weeding method")], suggested: everywhere },
  Monitoring: { notesLabel: "Observations", defaults: [], suggested: [...observation, ...everywhere] },
  "Soil Testing": { notesLabel: "Results / observations", defaults: [item("Test type")], suggested: everywhere },
  Seeding: { defaults: [item("Seed / variety"), ...quantity("Seed sown", ["kg", "g", "lb", "seeds", "trays"])], suggested: everywhere },
  "Pest Control": { defaults: [item("Product"), ...quantity("Amount applied", treatmentUnits)], suggested: [...application, ...everywhere] },
} as const satisfies Record<string, ActivityFormDef>;

export type WorkActivity = keyof typeof logFormCatalog;
export const workActivities = Object.keys(logFormCatalog) as [WorkActivity, ...WorkActivity[]];
const catalog: Record<string, ActivityFormDef> = logFormCatalog;

/** A field the farm defined itself. Keys are `custom_` plus lowercase letters, digits or underscores. */
export type CustomLogField = Omit<LogFieldDef, "unitKey" | "hint"> & { activities: string[] };
/** A farm's choices on top of the catalog; stored as the workspace `logForm` section. */
export type LogFormSettings = {
  /** Suggested field keys switched on, by activity. */
  enabled: Record<string, string[]>;
  /** Default field keys switched off, by activity. */
  hidden: Record<string, string[]>;
  custom: CustomLogField[];
};
export const defaultLogFormSettings: LogFormSettings = { enabled: {}, hidden: {}, custom: [] };
export const CUSTOM_KEY_PATTERN = /^custom_[a-z0-9_]{1,40}$/;
export const MAX_CUSTOM_LOG_FIELDS = 40;

export type ResolvedActivityForm = { notesLabel?: string; fields: LogFieldDef[] };
/** What one farm actually collects, by activity. Sent to the phone and used by the server. */
export type ResolvedLogForm = Record<string, ResolvedActivityForm>;

/** A number and its unit travel together: hiding or enabling one applies to both. */
function withPairs(keys: readonly string[], fields: readonly LogFieldDef[]): Set<string> {
  const result = new Set(keys);
  for (const field of fields) if (field.unitKey && (result.has(field.key) || result.has(field.unitKey))) { result.add(field.key); result.add(field.unitKey); }
  return result;
}

export function resolveLogForm(settings: LogFormSettings = defaultLogFormSettings): ResolvedLogForm {
  const form: ResolvedLogForm = {};
  for (const [activity, def] of Object.entries(catalog)) {
    const hidden = withPairs(settings.hidden[activity] ?? [], def.defaults);
    const enabled = withPairs(settings.enabled[activity] ?? [], def.suggested);
    const custom = settings.custom.filter(field => field.activities.includes(activity)).map(({ activities: _, ...field }) => field);
    form[activity] = { ...(def.notesLabel ? { notesLabel: def.notesLabel } : {}),
      fields: [...def.defaults.filter(field => !hidden.has(field.key)), ...def.suggested.filter(field => enabled.has(field.key)), ...custom] };
  }
  return form;
}

/** Every field a form can ask for, one definition per key, with select options merged across activities. */
export function allLogFields(form: ResolvedLogForm): LogFieldDef[] {
  const byKey = new Map<string, LogFieldDef>();
  for (const { fields } of Object.values(form)) for (const field of fields) {
    const seen = byKey.get(field.key);
    if (!seen) byKey.set(field.key, { ...field, options: field.options ? [...field.options] : undefined });
    else if (field.options) seen.options = [...new Set([...(seen.options ?? []), ...field.options])];
  }
  return [...byKey.values()];
}

export type LogDetailsProblem = { key: string; message: string };
const MAX_DETAIL_TEXT = 200;

/**
 * Checks values against one activity's fields. Empty values are dropped. `keepUnknown` retains
 * bounded values under keys the form no longer has (an offline draft made before the farm
 * changed its form, or a record saved under an earlier form) instead of reporting them.
 */
export function checkLogDetails(form: ResolvedLogForm, activity: string, input: Record<string, LogDetailValue>, keepUnknown = false): { details: LogDetails; problems: LogDetailsProblem[] } {
  const fields = form[activity]?.fields ?? [];
  const details: LogDetails = {};
  const problems: LogDetailsProblem[] = [];
  for (const [key, raw] of Object.entries(input)) {
    const value = typeof raw === "string" ? raw.trim() : raw;
    if (value === null || value === "") continue;
    const field = fields.find(item => item.key === key);
    if (!field) {
      if (!keepUnknown) problems.push({ key, message: "This activity does not collect that detail." });
      else if (typeof value === "number" ? Number.isFinite(value) : value.length <= MAX_DETAIL_TEXT) details[key] = value;
      continue;
    }
    if (field.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1e9) problems.push({ key, message: `${field.label} must be a number.` });
      else details[key] = value;
    } else if (typeof value !== "string" || value.length > MAX_DETAIL_TEXT) problems.push({ key, message: `${field.label} must be text of at most ${MAX_DETAIL_TEXT} characters.` });
    else if (field.type === "select" && !field.options?.includes(value)) problems.push({ key, message: `Choose one of the ${field.label.toLowerCase()} options.` });
    else details[key] = value;
  }
  for (const field of fields) if (field.unitKey && details[field.key] !== undefined && details[field.unitKey] === undefined && fields.some(item => item.key === field.unitKey)) {
    problems.push({ key: field.unitKey, message: `Choose a unit for ${field.label.toLowerCase()}.` });
  }
  return { details, problems };
}

/** The item and quantity line appended to a saved log's summary, e.g. "Treatment: neem oil 2 L". */
export function treatmentSummary(details: Record<string, LogDetailValue | undefined>): string {
  const parts = [details.product, details.amount, details.unit].filter(value => value !== null && value !== undefined && value !== "");
  return parts.length ? `Treatment: ${parts.join(" ")}` : "";
}

// Spoken phrasing for the hands-free voice mode (`src/contracts/voice.ts`). Kept beside the
// catalog so a new field gets its question here; anything unlisted falls back to its label.

/** The fixed core facts a log cannot be saved without, in the order the voice mode asks for them. */
export const requiredCoreLogFields = ["fieldId", "activity", "workDate", "startTime", "endTime"] as const;

/** Question fragments by field key; `Activity.key` overrides the general wording for one activity. */
const spokenAsks: Record<string, string> = {
  fieldId: "which field was this in", activity: "what kind of work did you do", workDate: "what day was this",
  startTime: "what time did you start", endTime: "what time did you finish",
  product: "what product did you use", amount: "how much did you apply", unit: "what unit was that amount in",
  "Fertilizing.product": "what fertilizer did you use",
  "Planting.product": "what crop or variety did you plant", "Planting.amount": "how many did you plant",
  "Irrigation.product": "what irrigation method did you use",
  "Harvesting.product": "what crop or variety did you harvest", "Harvesting.amount": "how much did you harvest",
  "Pruning.product": "what crop or variety did you prune", "Soil work.product": "what soil operation did you do",
  "Equipment maintenance.product": "what equipment did you work on", "Weeding.product": "what weeding method did you use",
  "Soil Testing.product": "what type of soil test was it",
  "Seeding.product": "what seed or variety did you sow", "Seeding.amount": "how much seed did you sow",
};
const spokenLabel = (label: string) => label.replace(/\s*\(.*?\)/g, "").replace(/\s*\/\s*/g, " or ").trim().toLowerCase();

/** A lowercase question fragment without punctuation, e.g. "what time did you finish". */
export function spokenAsk(key: string, activity?: string | null, field?: Pick<LogFieldDef, "label">): string {
  return spokenAsks[`${activity}.${key}`] ?? spokenAsks[key] ?? `what was the ${spokenLabel(field?.label ?? key)}`;
}

const spokenUnits: Record<string, string> = { L: "liters", mL: "milliliters", kg: "kilograms", g: "grams", gal: "gallons", lb: "pounds", ha: "hectares" };
/** Unit abbreviations are expanded so text-to-speech does not spell them out. */
export const spokenUnit = (unit: string) => spokenUnits[unit] ?? unit;

/**
 * Detail keys a log of this activity cannot be saved without: the catalog defaults (item, quantity
 * and unit) that the farm has not hidden, matching the native form's save check. Suggested and
 * custom fields stay optional, as in `checkLogDetails`.
 */
export function requiredLogDetailKeys(form: ResolvedLogForm, activity: string): string[] {
  const defaults = new Set((catalog[activity]?.defaults ?? []).map(field => field.key));
  return (form[activity]?.fields ?? []).filter(field => defaults.has(field.key)).map(field => field.key);
}
