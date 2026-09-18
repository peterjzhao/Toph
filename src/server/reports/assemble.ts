/**
 * Builds each report's frozen document from logs and their facts.
 *
 * Pure and deterministic, so it is tested without a model. Each builder follows its official
 * record (reportCatalog[kind].sourceUrl). A required value no log states is null and becomes a
 * gap. A value is computed only when every input to the computation is stated.
 */
import {
  REPORT_DOCUMENT_VERSION, reportCatalog,
  type ReportCell, type ReportDocument, type ReportFactKey, type ReportGap, type ReportHeaderField, type ReportKind, type ReportRow, type ReportSection,
} from "@/contracts/reports";

export type ReportFacts = Partial<Record<ReportFactKey, ReportCell>>;
export type ReportLog = {
  id: string; date: string; employee: string; activity: string; field: string;
  /** Wall-clock HH:MM in the farm timezone. */
  start: string; end: string;
  hours: number; notes: string; facts: ReportFacts;
};
export type AssembleInput = {
  kind: ReportKind;
  farm: { name: string; timezone: string };
  period: { from: string; to: string };
  generatedAt: string;
  detection: ReportDocument["detection"];
  /** Logs dated inside the period, oldest first. */
  logs: ReportLog[];
  /** Pesticide and fertilizer logs from the LOOKBACK_DAYS before the period, for pre-harvest checks. */
  earlierApplications: ReportLog[];
};

/** How far before a harvest applications are checked against their pre-harvest interval. */
export const LOOKBACK_DAYS = 90;
export const PESTICIDE_ACTIVITIES: ReadonlySet<string> = new Set(["Spraying", "Pest Control"]);
export const INPUT_ACTIVITIES: ReadonlySet<string> = new Set(["Spraying", "Pest Control", "Fertilizing"]);
const PLANTING_ACTIVITIES: ReadonlySet<string> = new Set(["Planting", "Seeding"]);
/** Activities whose log-form `product` is a crop, not a material. */
const CROP_PRODUCT_ACTIVITIES: ReadonlySet<string> = new Set(["Harvesting", "Planting", "Pruning", "Seeding"]);
const SHARED_DETAIL_KEYS: ReadonlySet<string> = new Set<ReportFactKey>([
  "amount", "unit", "applicationRate", "applicationMethod", "epaRegNumber", "targetPest", "areaCovered", "areaUnit",
  "equipmentUsed", "waterSource", "destination", "lotNumber", "preHarvestDays", "reentryHours",
]);

/** Files a log's recorded details under report fact keys. Recorded values carry no quote. */
export function recordedFacts(activity: string, details: Record<string, string | number>): ReportFacts {
  const facts: ReportFacts = {};
  for (const [key, value] of Object.entries(details)) {
    if (value === "" || value === null || value === undefined) continue;
    if (key === "product") {
      const target: ReportFactKey | null = CROP_PRODUCT_ACTIVITIES.has(activity) ? "commodity" : INPUT_ACTIVITIES.has(activity) ? "product" : activity === "Irrigation" ? "irrigationMethod" : null;
      if (target) facts[target] = { value };
    } else if (SHARED_DETAIL_KEYS.has(key)) {
      facts[key as ReportFactKey] = { value };
    }
  }
  const weather = [
    typeof details.windSpeedMph === "number" ? `wind ${details.windSpeedMph} mph${typeof details.windDirection === "string" ? ` ${details.windDirection}` : ""}` : null,
    typeof details.temperatureF === "number" ? `${details.temperatureF} °F` : null,
  ].filter(Boolean).join(", ");
  if (weather) facts.weather = { value: weather };
  return facts;
}

/** Recorded values win; a detected fact only fills a key nothing recorded. */
export function mergeFacts(recorded: ReportFacts, detected: readonly { key: ReportFactKey; value: string | number; quote: string }[]): ReportFacts {
  const facts: ReportFacts = { ...recorded };
  for (const fact of detected) if (!facts[fact.key]) facts[fact.key] = { value: fact.value, quote: fact.quote };
  return facts;
}

const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const longDayFormat = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthFormat = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const asDate = (iso: string) => new Date(`${iso}T12:00:00Z`);
export const dayLabel = (iso: string) => dayFormat.format(asDate(iso));
const clock = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const daysBetween = (from: string, to: string) => Math.round((asDate(to).getTime() - asDate(from).getTime()) / 86_400_000);
const lastDayOfMonth = (iso: string) => { const d = asDate(iso); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10); };
const isWholeMonth = (from: string, to: string) => from.endsWith("-01") && to === lastDayOfMonth(from);
export const periodLabel = (from: string, to: string) => isWholeMonth(from, to) ? monthFormat.format(asDate(from)) : `${dayLabel(from)} – ${dayLabel(to)}`;
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const said = (value: string | number | null): ReportCell => ({ value });
const unknown: ReportCell = { value: null };
const fact = (log: ReportLog, key: ReportFactKey): ReportCell => log.facts[key] ?? unknown;
const quoteOf = (...cells: (ReportCell | undefined)[]) => [...new Set(cells.map(cell => cell?.quote).filter(Boolean))].join(" … ") || undefined;
const withQuote = (value: string | number, quote: string | undefined): ReportCell => quote ? { value, quote } : { value };
const orSaid = (cell: ReportCell, fallback: string): ReportCell => cell.value === null ? said(fallback) : cell;

/** Amount and unit together; a number without its unit is not a quantity. */
function quantity(log: ReportLog): ReportCell {
  const amount = log.facts.amount, unit = log.facts.unit;
  if (amount?.value == null || unit?.value == null) return unknown;
  return withQuote(`${amount.value} ${unit.value}`, quoteOf(amount, unit));
}
function area(log: ReportLog): ReportCell {
  const size = log.facts.areaCovered, unit = log.facts.areaUnit;
  if (size?.value == null || unit?.value == null) return unknown;
  return withQuote(`${size.value} ${unit.value}`, quoteOf(size, unit));
}
/** Area only when it is a land measure; a count of rows is not acreage. */
function acres(log: ReportLog): ReportCell {
  return log.facts.areaUnit?.value === "rows" ? unknown : area(log);
}
function commodity(log: ReportLog): ReportCell {
  const crop = log.facts.commodity, variety = log.facts.variety;
  if (crop?.value == null) return unknown;
  return variety?.value == null ? crop : withQuote(`${crop.value}, ${variety.value}`, quoteOf(crop, variety));
}
/** Rate as said, or a stated amount over a stated area. */
function rate(log: ReportLog): ReportCell {
  const stated = fact(log, "applicationRate");
  if (stated.value !== null) return stated;
  const amount = quantity(log), size = area(log);
  return amount.value !== null && size.value !== null ? withQuote(`${amount.value} over ${size.value}`, quoteOf(amount, size)) : unknown;
}
/** DPR's air/ground split, keeping the words used. A method it does not recognize stays as said. */
function purMethod(log: ReportLog): ReportCell {
  const method = fact(log, "applicationMethod");
  if (method.value === null) return unknown;
  const words = String(method.value).toLowerCase();
  const code = /plane|aircraft|aerial|helicopter|drone|uav|uas/.test(words) ? "Air"
    : /fumigat/.test(words) ? "Fumigation"
    : /truck|tractor|boom|backpack|hand|ground|rig|atv|airblast|spreader|sprayer/.test(words) ? "Ground" : null;
  return code ? withQuote(`${code} (${method.value})`, method.quote) : method;
}
const inDays = (cell: ReportCell): ReportCell => cell.value === null ? unknown : withQuote(plural(Number(cell.value), "day"), cell.quote);

type GapBucket = { detail?: string; logIds: string[] };
class Gaps {
  private readonly buckets = new Map<string, GapBucket>();
  /** Marks `cell` missing from `logId` when it has no value; returns the cell for inline use. */
  need(label: string, cell: ReportCell, logId: string): ReportCell {
    if (cell.value === null) {
      const bucket = this.buckets.get(label) ?? { logIds: [] };
      if (!bucket.logIds.includes(logId)) bucket.logIds.push(logId);
      this.buckets.set(label, bucket);
    }
    return cell;
  }
  /** A farm-level item Toph does not hold, such as a permit number. */
  farm(label: string, detail: string): ReportCell {
    this.buckets.set(label, { detail, logIds: [] });
    return unknown;
  }
  /** `totals` gives, per label, how many records needed it. */
  list(noun: string, totals: ReadonlyMap<string, number>): ReportGap[] {
    return [...this.buckets].map(([label, bucket]) => ({
      label,
      detail: bucket.detail ?? `Not recorded on ${bucket.logIds.length} of ${plural(totals.get(label) ?? bucket.logIds.length, noun)}.`,
      logIds: bucket.logIds,
    }));
  }
}

type Built = { header: ReportHeaderField[]; sections: ReportSection[]; gaps: ReportGap[]; count: number; noun: string };
const row = (logIds: string[], cells: ReportCell[]): ReportRow => ({ cells, logIds });
const NOT_ON_FILE = "Not on file in Toph. Add it before filing.";
const everyLabel = (labels: readonly string[], count: number) => new Map(labels.map(label => [label, count]));

function priorApplications(input: AssembleInput, harvest: ReportLog): ReportLog[] {
  return [...input.earlierApplications, ...input.logs]
    .filter(log => INPUT_ACTIVITIES.has(log.activity) && log.field === harvest.field && log.id !== harvest.id
      && log.date <= harvest.date && daysBetween(log.date, harvest.date) <= LOOKBACK_DAYS)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}

function pesticideUse(input: AssembleInput): Built {
  const gaps = new Gaps();
  const apps = input.logs.filter(log => PESTICIDE_ACTIVITIES.has(log.activity));
  const { from, to } = input.period;
  const oneMonth = from.slice(0, 7) === to.slice(0, 7);
  const due = new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)), 10)).toISOString().slice(0, 10);
  const header: ReportHeaderField[] = [
    { label: "Operator of the property", cell: said(input.farm.name) },
    { label: "Operator ID number (OIN)", cell: gaps.farm("Operator ID number (OIN)", `Issued by the County Agricultural Commissioner. ${NOT_ON_FILE}`) },
    { label: "County", cell: gaps.farm("County", NOT_ON_FILE) },
    { label: oneMonth ? "Month of application" : "Period", cell: said(periodLabel(from, to)) },
    { label: "Due to the county", cell: said(oneMonth ? longDayFormat.format(asDate(due)) : "The 10th of the month after each month of use") },
  ];
  const rows = apps.map(log => row([log.id], [
    said(`${dayLabel(log.date)}, ${clock(log.end)}`),
    said(log.field),
    gaps.need("Site ID number", unknown, log.id),
    gaps.need("Commodity treated", commodity(log), log.id),
    gaps.need("Acres treated", area(log), log.id),
    gaps.need("Acres planted", unknown, log.id),
    gaps.need("Product name", fact(log, "product"), log.id),
    gaps.need("EPA or California registration number", fact(log, "epaRegNumber"), log.id),
    gaps.need("Amount of undiluted product", quantity(log), log.id),
    gaps.need("Application method", purMethod(log), log.id),
    log.facts.pestControlBusiness?.value ? withQuote(`${log.facts.pestControlBusiness.value} (pest control business)`, log.facts.pestControlBusiness.quote) : said(log.employee),
  ]));
  const byBusiness = apps.some(log => log.facts.pestControlBusiness?.value);
  const labels = ["Site ID number", "Commodity treated", "Acres treated", "Acres planted", "Product name", "EPA or California registration number", "Amount of undiluted product", "Application method"];
  return {
    header, count: apps.length, noun: "application",
    sections: [{
      title: "Applications", rows,
      columns: ["Completed", "Field", "Site ID", "Commodity", "Acres treated", "Acres planted", "Product", "EPA / CA reg. no.", "Amount used", "Method", "Applied by"],
      ...(byBusiness ? { note: "A pest control business reports its own applications; leave them off the grower's report." } : {}),
      emptyText: "No pesticide applications were recorded in this period.",
    }],
    gaps: gaps.list("application", everyLabel(labels, apps.length)),
  };
}

function foodSafety(input: AssembleInput): Built {
  const gaps = new Gaps();
  const inputs = input.logs.filter(log => INPUT_ACTIVITIES.has(log.activity));
  const pesticides = inputs.filter(log => PESTICIDE_ACTIVITIES.has(log.activity));
  const harvests = input.logs.filter(log => log.activity === "Harvesting");
  const irrigations = input.logs.filter(log => log.activity === "Irrigation");
  const applicationRows = inputs.map(log => row([log.id], [
    said(dayLabel(log.date)), said(log.field),
    gaps.need("Crop", commodity(log), log.id),
    gaps.need("Material applied", fact(log, "product"), log.id),
    gaps.need("Application rate", rate(log), log.id),
    gaps.need("Application method", fact(log, "applicationMethod"), log.id),
    PESTICIDE_ACTIVITIES.has(log.activity) ? gaps.need("Pre-harvest interval", inDays(fact(log, "preHarvestDays")), log.id) : said("Not applicable"),
    said(log.employee),
  ]));
  const harvestRows = harvests.map(log => {
    const prior = priorApplications(input, log).filter(app => PESTICIDE_ACTIVITIES.has(app.activity));
    const last = prior.at(-1);
    let check: ReportCell;
    if (!prior.length) check = said(`No pesticide application on ${log.field} in the ${LOOKBACK_DAYS} days before`);
    else if (prior.some(app => app.facts.preHarvestDays?.value == null)) check = gaps.need("Pre-harvest interval check", unknown, log.id);
    else {
      const early = prior.filter(app => daysBetween(app.date, log.date) < Number(app.facts.preHarvestDays!.value));
      check = said(early.length ? `Not met: ${early.map(app => `the ${dayLabel(app.date)} application needs ${app.facts.preHarvestDays!.value} days`).join("; ")}` : "Met for every prior application");
    }
    return row([log.id, ...prior.map(app => app.id)], [
      said(dayLabel(log.date)), said(log.field),
      gaps.need("Crop", commodity(log), log.id),
      last ? said(`${dayLabel(last.date)}: ${last.facts.product?.value ?? "product not recorded"}`) : said("None recorded"),
      check,
    ]);
  });
  const irrigationRows = irrigations.map(log => row([log.id], [
    said(dayLabel(log.date)), said(log.field), fact(log, "irrigationMethod"),
    gaps.need("Irrigation water source", fact(log, "waterSource"), log.id),
  ]));
  gaps.farm("Water test results", "Microbial test results for irrigation and spray water are not stored in Toph.");
  gaps.farm("Worker food safety training", "Training and retraining records are not stored in Toph.");
  const totals = new Map<string, number>([
    ["Crop", inputs.length + harvests.length], ["Material applied", inputs.length], ["Application rate", inputs.length], ["Application method", inputs.length],
    ["Pre-harvest interval", pesticides.length], ["Pre-harvest interval check", harvests.length], ["Irrigation water source", irrigations.length],
  ]);
  return {
    header: [
      { label: "Operation", cell: said(input.farm.name) },
      { label: "Records period", cell: said(periodLabel(input.period.from, input.period.to)) },
    ],
    count: inputs.length + harvests.length + irrigations.length, noun: "record",
    sections: [
      { title: "Chemical and fertilizer applications", columns: ["Date", "Field", "Crop", "Material", "Rate", "Method", "Pre-harvest interval", "Applied by"], rows: applicationRows, emptyText: "No applications were recorded in this period." },
      { title: "Harvests and pre-harvest intervals", note: `Each harvest is checked against pesticide applications on the same field in the ${LOOKBACK_DAYS} days before it.`, columns: ["Harvest date", "Field", "Crop", "Last application on field", "Interval check"], rows: harvestRows, emptyText: "No harvests were recorded in this period." },
      { title: "Irrigation water", columns: ["Date", "Field", "Method", "Water source"], rows: irrigationRows, emptyText: "No irrigation was recorded in this period." },
      { title: "Water tests", columns: ["Date", "Source", "Result"], rows: [], emptyText: "Toph does not store water test results." },
      { title: "Worker food safety training", columns: ["Date", "Worker", "Topic"], rows: [], emptyText: "Toph does not store training records." },
    ],
    gaps: gaps.list("record", totals),
  };
}

function harvestTraceability(input: AssembleInput): Built {
  const gaps = new Gaps();
  const harvests = input.logs.filter(log => log.activity === "Harvesting");
  const header: ReportHeaderField[] = [
    { label: "Business name", cell: said(input.farm.name) },
    { label: "Farm location", cell: gaps.farm("Farm location (address)", `The street address of the farm where the food was harvested. ${NOT_ON_FILE}`) },
    { label: "Phone number", cell: gaps.farm("Phone number", `The harvester's business phone, given to the initial packer. ${NOT_ON_FILE}`) },
  ];
  const kdeRows = harvests.map(log => row([log.id], [
    gaps.need("Commodity and variety", commodity(log), log.id),
    gaps.need("Quantity and unit of measure", quantity(log), log.id),
    said(input.farm.name),
    said(log.field),
    said(dayLabel(log.date)),
    gaps.need("Immediate subsequent recipient", fact(log, "destination"), log.id),
    said(`Toph harvest log ${log.id}`),
    orSaid(fact(log, "lotNumber"), "Not required at harvest"),
  ]));
  const backRows = harvests.flatMap(log => priorApplications(input, log).map(app => row([log.id, app.id], [
    said(dayLabel(log.date)), said(log.field), said(dayLabel(app.date)), said(app.activity),
    orSaid(fact(app, "product"), "Not recorded"),
    said(daysBetween(app.date, log.date)),
    orSaid(inDays(fact(app, "preHarvestDays")), "Not recorded"),
  ])));
  const labels = ["Commodity and variety", "Quantity and unit of measure", "Immediate subsequent recipient"];
  return {
    header, count: harvests.length, noun: "harvest",
    sections: [
      { title: "Harvesting key data elements", note: "One row per harvest, with the elements 21 CFR 1.1325(a) requires.", columns: ["Commodity and variety", "Quantity and unit", "Farm where harvested", "Field", "Date of harvesting", "Immediate subsequent recipient", "Reference document", "Lot code"], rows: kdeRows, emptyText: "No harvests were recorded in this period." },
      { title: "Applications before each harvest", note: `One step back: applications on the harvested field in the ${LOOKBACK_DAYS} days before.`, columns: ["Harvest date", "Field", "Applied on", "Activity", "Product", "Days before harvest", "Stated pre-harvest interval"], rows: backRows, emptyText: `No applications were recorded on harvested fields in the ${LOOKBACK_DAYS} days before harvest.` },
    ],
    gaps: gaps.list("harvest", everyLabel(labels, harvests.length)),
  };
}

function laborHours(input: AssembleInput): Built {
  const gaps = new Gaps();
  const byDay = new Map<string, ReportLog[]>();
  for (const log of input.logs) {
    const key = JSON.stringify([log.date, log.employee]);
    byDay.set(key, [...(byDay.get(key) ?? []), log]);
  }
  const dayRows = [...byDay.values()]
    .sort((a, b) => a[0].date.localeCompare(b[0].date) || a[0].employee.localeCompare(b[0].employee))
    .map(logs => {
      const began = logs.map(log => log.start).sort()[0];
      const ended = logs.map(log => log.end).sort().at(-1)!;
      const hours = Math.round(logs.reduce((sum, log) => sum + log.hours, 0) * 100) / 100;
      return row(logs.map(log => log.id), [
        said(dayLabel(logs[0].date)), said(logs[0].employee), said(clock(began)), said(clock(ended)), said(hours),
        said([...new Set(logs.map(log => `${log.activity} (${log.field})`))].join("; ")),
      ]);
    });
  const workers = new Map<string, { days: Set<string>; hours: number; logIds: string[] }>();
  for (const log of input.logs) {
    const worker = workers.get(log.employee) ?? { days: new Set<string>(), hours: 0, logIds: [] };
    worker.days.add(log.date);
    worker.hours += log.hours;
    worker.logIds.push(log.id);
    workers.set(log.employee, worker);
  }
  const totalRows = [...workers].sort(([a], [b]) => a.localeCompare(b))
    .map(([name, worker]) => row(worker.logIds, [said(name), said(worker.days.size), said(Math.round(worker.hours * 100) / 100)]));
  const payroll = "Not tracked in Toph. Add it from payroll.";
  const header: ReportHeaderField[] = [
    { label: "Employer", cell: said(input.farm.name) },
    { label: "Employer address", cell: gaps.farm("Employer address", NOT_ON_FILE) },
    { label: "Employer FEIN", cell: gaps.farm("Employer FEIN", NOT_ON_FILE) },
    { label: "Pay period", cell: said(periodLabel(input.period.from, input.period.to)) },
  ];
  return {
    header, count: dayRows.length, noun: "worker-day",
    sections: [
      { title: "Hours actually worked each day", note: "Recorded work time from activity logs. Time a worker spent without logging is not counted.", columns: ["Date", "Worker", "Began", "Ended", "Hours worked", "Work performed"], rows: dayRows, emptyText: "No work was recorded in this period." },
      { title: "Totals by worker", columns: ["Worker", "Days worked", "Hours worked"], rows: totalRows, emptyText: "No work was recorded in this period." },
    ],
    gaps: [
      ...gaps.list("worker-day", new Map()),
      { label: "Hours offered", detail: `Hours offered each day, split at the three-fourths guarantee. ${payroll}`, logIds: [] },
      { label: "Rate of pay", detail: `Hourly and piece rates. ${payroll}`, logIds: [] },
      { label: "Earnings", detail: `Total earnings for the pay period. ${payroll}`, logIds: [] },
      { label: "Deductions", detail: `Each deduction and its reason. ${payroll}`, logIds: [] },
    ],
  };
}

function organic(input: AssembleInput): Built {
  const gaps = new Gaps();
  const inputs = input.logs.filter(log => INPUT_ACTIVITIES.has(log.activity));
  const plantings = input.logs.filter(log => PLANTING_ACTIVITIES.has(log.activity));
  const harvests = input.logs.filter(log => log.activity === "Harvesting");
  const inputRows = inputs.map(log => row([log.id], [
    said(dayLabel(log.date)), said(log.field),
    gaps.need("Material applied", fact(log, "product"), log.id),
    gaps.need("Amount or rate", rate(log).value !== null ? rate(log) : quantity(log), log.id),
    fact(log, "equipmentUsed").value !== null ? fact(log, "equipmentUsed") : fact(log, "applicationMethod"),
    said(log.employee),
    fact(log, "weather"),
    gaps.need("Organic approval of each input", unknown, log.id),
  ]));
  const plantingRows = plantings.map(log => row([log.id], [
    said(dayLabel(log.date)), said(log.field),
    gaps.need("Seed or planting stock", commodity(log), log.id),
    quantity(log),
    gaps.need("Organic status of seed", unknown, log.id),
  ]));
  const harvestRows = harvests.map(log => row([log.id], [
    said(dayLabel(log.date)), said(log.field),
    gaps.need("Harvested crop", commodity(log), log.id),
    gaps.need("Harvested quantity", quantity(log), log.id),
    gaps.need("Where the harvest went", fact(log, "destination"), log.id),
  ]));
  const activityRows = input.logs.map(log => row([log.id], [
    said(dayLabel(log.date)), said(log.field), said(log.activity), said(log.employee), said(`${clock(log.start)}–${clock(log.end)}`),
    said(log.notes.length > 160 ? `${log.notes.slice(0, 157).trimEnd()}…` : log.notes),
  ]));
  return {
    header: [
      { label: "Operation", cell: said(input.farm.name) },
      { label: "Records period", cell: said(periodLabel(input.period.from, input.period.to)) },
      { label: "Retention", cell: said("Keep for at least 5 years") },
    ],
    count: input.logs.length, noun: "log",
    sections: [
      { title: "Input applications", columns: ["Date", "Field", "Material", "Amount or rate", "Equipment", "Operator", "Weather", "Approved for organic use"], rows: inputRows, emptyText: "No inputs were applied in this period." },
      { title: "Seed and planting stock", columns: ["Date", "Field", "Seed or crop", "Quantity", "Organic seed"], rows: plantingRows, emptyText: "No planting or seeding was recorded in this period." },
      { title: "Harvests", columns: ["Date", "Field", "Crop", "Quantity", "Sold or moved to"], rows: harvestRows, emptyText: "No harvests were recorded in this period." },
      { title: "Field activity log", columns: ["Date", "Field", "Activity", "Worker", "Time", "Notes"], rows: activityRows, emptyText: "No work was recorded in this period." },
    ],
    gaps: gaps.list("record", new Map([
      ["Material applied", inputs.length], ["Amount or rate", inputs.length], ["Organic approval of each input", inputs.length],
      ["Seed or planting stock", plantings.length], ["Organic status of seed", plantings.length],
      ["Harvested crop", harvests.length], ["Harvested quantity", harvests.length], ["Where the harvest went", harvests.length],
    ])),
  };
}

function acreage(input: AssembleInput): Built {
  const gaps = new Gaps();
  const plantings = input.logs.filter(log => PLANTING_ACTIVITIES.has(log.activity));
  const rows = plantings.map(log => {
    const irrigation = input.logs.find(other => other.activity === "Irrigation" && other.field === log.field);
    return row(irrigation ? [log.id, irrigation.id] : [log.id], [
      said(log.field),
      gaps.need("FSA tract number", unknown, log.id),
      gaps.need("FSA field number", unknown, log.id),
      gaps.need("Crop", commodity(log), log.id),
      gaps.need("Intended use", unknown, log.id),
      gaps.need("Acres", acres(log), log.id),
      irrigation ? said("Irrigated") : gaps.need("Irrigation practice", unknown, log.id),
      said(dayLabel(log.date)),
      gaps.need("Producer share", unknown, log.id),
    ]);
  });
  const labels = ["FSA tract number", "FSA field number", "Crop", "Intended use", "Acres", "Irrigation practice", "Producer share"];
  return {
    header: [
      { label: "FSA farm number", cell: gaps.farm("FSA farm number", `Assigned by the county FSA office. ${NOT_ON_FILE}`) },
      { label: "Operator", cell: said(input.farm.name) },
      { label: "Crop year", cell: said(Number(input.period.to.slice(0, 4))) },
    ],
    count: plantings.length, noun: "planting",
    sections: [{
      title: "Crops and acreage", rows,
      note: "Fields with a planting or seeding log in this period. A field counts as irrigated when an irrigation log exists for it.",
      columns: ["Field", "FSA tract", "FSA field", "Crop", "Intended use", "Acres", "Irrigation practice", "Planting date", "Producer share"],
      emptyText: "No planting or seeding was recorded in this period.",
    }],
    gaps: gaps.list("planting", everyLabel(labels, plantings.length)),
  };
}

const POUNDS_PER: Record<string, number> = { lb: 1, lbs: 1, pound: 1, pounds: 1, kg: 2.20462, kilograms: 2.20462 };

/** Pounds of nitrogen per acre from one fertilizing log; null unless amount, grade and acres are all stated. */
function nitrogenPerAcre(log: ReportLog): number | null {
  const amount = Number(log.facts.amount?.value), percent = Number(log.facts.nitrogenPercent?.value), size = Number(log.facts.areaCovered?.value);
  const pounds = POUNDS_PER[String(log.facts.unit?.value ?? "").toLowerCase()];
  if (!pounds || !(amount > 0) || !(percent > 0) || !(size > 0) || log.facts.areaUnit?.value !== "acres") return null;
  return amount * pounds * (percent / 100) / size;
}

function nitrogen(input: AssembleInput): Built {
  const gaps = new Gaps();
  const relevant = input.logs.filter(log => ["Fertilizing", "Irrigation", "Harvesting"].includes(log.activity));
  const fields = [...new Set(relevant.map(log => log.field))].sort();
  const fertilizedFields = fields.filter(field => relevant.some(log => log.field === field && log.activity === "Fertilizing"));
  const rows = fields.map(field => {
    const logs = relevant.filter(log => log.field === field);
    const anchor = logs[0].id;
    const fertilizings = logs.filter(log => log.activity === "Fertilizing");
    const irrigations = logs.filter(log => log.activity === "Irrigation");
    const harvests = logs.filter(log => log.activity === "Harvesting");
    const first = (cells: ReportCell[]) => cells.find(cell => cell.value !== null) ?? unknown;
    const perLog = fertilizings.map(nitrogenPerAcre);
    const totalN = perLog.every(value => value !== null) ? said(Math.round(perLog.reduce<number>((sum, value) => sum + (value ?? 0), 0) * 10) / 10) : unknown;
    const products = fertilizings.map(log => log.facts.product?.value).filter(value => value != null);
    return row(logs.map(log => log.id), [
      said(field),
      gaps.need("Assessor's parcel number (APN)", unknown, anchor),
      gaps.need("Crop", first(logs.map(commodity)), anchor),
      gaps.need("Irrigated acres", first(irrigations.map(acres)), anchor),
      gaps.need("Irrigation method", first(irrigations.map(log => fact(log, "irrigationMethod"))), anchor),
      said(fertilizings.length ? `${plural(fertilizings.length, "application")}${products.length ? `: ${products.join(", ")}` : ", product not recorded"}` : "None"),
      fertilizings.length ? gaps.need("Total nitrogen applied", totalN, anchor) : said("None recorded"),
      gaps.need("Harvested yield", first(harvests.map(quantity)), anchor),
    ]);
  });
  const labels = ["Assessor's parcel number (APN)", "Crop", "Irrigated acres", "Irrigation method", "Harvested yield"];
  return {
    header: [
      { label: "Member ID", cell: gaps.farm("Coalition member ID", `Issued by your water quality coalition. ${NOT_ON_FILE}`) },
      { label: "Crop year", cell: said(Number(input.period.to.slice(0, 4))) },
    ],
    count: fields.length, noun: "field",
    sections: [{
      title: "Nitrogen by field", rows,
      note: "Nitrogen is calculated only when a log states the fertilizer amount, its grade and the acres covered. Your coalition calculates the applied-to-removed (A/R) ratio from total nitrogen and yield.",
      columns: ["Field", "APN", "Crop", "Irrigated acres", "Irrigation method", "Fertilizer applications", "Total N applied (lb/acre)", "Harvested yield"],
      emptyText: "No fertilizing, irrigation or harvest was recorded in this period.",
    }],
    gaps: gaps.list("field", new Map([...everyLabel(labels, fields.length), ["Total nitrogen applied", fertilizedFields.length]])),
  };
}

const builders: Record<ReportKind, (input: AssembleInput) => Built> = {
  "pesticide-use": pesticideUse, "food-safety": foodSafety, "harvest-traceability": harvestTraceability,
  "labor-hours": laborHours, organic, acreage, nitrogen,
};

export function assembleReport(input: AssembleInput): ReportDocument {
  const { formTitle, authority, recipient, cadence, sourceUrl } = reportCatalog[input.kind];
  const built = builders[input.kind](input);
  const when = `between ${dayLabel(input.period.from)} and ${dayLabel(input.period.to)}`;
  const readiness: ReportDocument["readiness"] = !built.count
    ? { status: "no-records", message: `No ${built.noun}s recorded ${when}.` }
    : built.gaps.length
      ? { status: "incomplete", message: `${plural(built.count, built.noun)} found. ${plural(built.gaps.length, "required item")} ${built.gaps.length === 1 ? "is" : "are"} missing.` }
      : { status: "ready", message: `Every required item is recorded for ${plural(built.count, built.noun)}.` };
  return {
    version: REPORT_DOCUMENT_VERSION, kind: input.kind,
    form: { formTitle, authority, recipient, cadence, sourceUrl },
    farm: input.farm, period: input.period, generatedAt: input.generatedAt, detection: input.detection,
    header: built.header, sections: built.sections, gaps: built.gaps, readiness,
  };
}
