/**
 * The regulatory reports Toph prepares, and the frozen document each one produces.
 *
 * One entry per report: the official record it follows, the authority behind it, who receives it
 * and the one-line description the Reports page shows. The detection prompt, the document
 * assembler and the Reports page all read this module, like the log-form catalog. Plain
 * TypeScript and zod only, so browser code can import it.
 *
 * A document is built from values recorded on a log and facts a log states in its own words.
 * Anything no log states stays null and is listed as a gap: nothing is looked up, estimated or
 * filled in from typical practice.
 */
import { z } from "zod";

export const REPORT_DOCUMENT_VERSION = 2 as const;

export const reportKinds = ["pesticide-use", "food-safety", "harvest-traceability", "labor-hours", "organic", "acreage", "nitrogen"] as const;
export type ReportKind = (typeof reportKinds)[number];

/** How long one report usually covers: a calendar month, a half-month pay period, or a year. */
export type ReportPeriod = "month" | "pay-period" | "year";

export type ReportDefinition = {
  /** Short name on the Reports page. */
  name: string;
  /** One line under the name. */
  description: string;
  /** The official record or form the document follows. */
  formTitle: string;
  authority: string;
  recipient: string;
  cadence: string;
  /** Primary source for the document's structure. */
  sourceUrl: string;
  /** The period the Reports page suggests; see suggestedPeriod. */
  period: ReportPeriod;
};

export const reportCatalog = {
  "pesticide-use": {
    name: "Pesticide Use Report",
    description: "Monthly pesticide applications for the county",
    formTitle: "Production Agricultural Pesticide Use Report",
    authority: "California DPR, 3 CCR §§ 6626–6627",
    recipient: "County Agricultural Commissioner",
    cadence: "Monthly, due the 10th of the following month",
    sourceUrl: "https://www.cdpr.ca.gov/wp-content/uploads/2026/04/volume_1_chapter_4.pdf",
    period: "month",
  },
  "food-safety": {
    name: "Food Safety Audit",
    description: "Spray, harvest, and water records for a GAP audit",
    formTitle: "Harmonized GAP Records Packet",
    authority: "USDA Harmonized GAP",
    recipient: "Third-party food safety auditor",
    cadence: "Yearly, at each audit",
    sourceUrl: "https://www.ams.usda.gov/services/auditing/gap-ghp/harmonized",
    period: "year",
  },
  "harvest-traceability": {
    name: "Harvest Traceability",
    description: "Trace each harvest to its field, date, and buyer",
    formTitle: "Harvesting Key Data Elements",
    authority: "FDA Food Traceability Rule, 21 CFR 1.1325(a)",
    recipient: "Initial packer; FDA within 24 hours on request",
    cadence: "Every harvest, and for mock recalls",
    sourceUrl: "https://www.law.cornell.edu/cfr/text/21/1.1325",
    period: "year",
  },
  "labor-hours": {
    name: "Labor Hours",
    description: "Daily hours per worker for payroll and H-2A",
    formTitle: "Worker Hours Record",
    authority: "H-2A, 20 CFR 655.122(j)–(k)",
    recipient: "Payroll; DOL Wage and Hour on request",
    cadence: "Every pay period; H-2A workers are paid at least twice a month",
    sourceUrl: "https://www.law.cornell.edu/cfr/text/20/655.122",
    period: "pay-period",
  },
  organic: {
    name: "Organic Records",
    description: "Inputs and field activities for organic inspection",
    formTitle: "Input Application and Field Activity Log",
    authority: "USDA National Organic Program, 7 CFR 205.103",
    recipient: "Organic certifier",
    cadence: "Yearly inspection; keep for 5 years",
    sourceUrl: "https://www.law.cornell.edu/cfr/text/7/205.103",
    period: "year",
  },
  acreage: {
    name: "Acreage Report",
    description: "Planted acres by field and crop for FSA",
    formTitle: "Report of Acreage (FSA-578)",
    authority: "USDA Farm Service Agency",
    recipient: "County FSA office",
    cadence: "Yearly, by each crop's FSA deadline",
    sourceUrl: "https://www.fsa.usda.gov/sites/default/files/2025-03/FSA-578.pdf",
    period: "year",
  },
  nitrogen: {
    name: "Nitrogen Summary",
    description: "Nitrogen applied and yield per field for your coalition",
    formTitle: "Irrigation and Nitrogen Management Plan Summary Report",
    authority: "California Irrigated Lands Regulatory Program",
    recipient: "Water quality coalition",
    cadence: "Yearly, per crop year",
    sourceUrl: "https://wwd.ca.gov/wp-content/uploads/2019/11/inmp-worksheet-instructions.pdf",
    period: "year",
  },
} as const satisfies Record<ReportKind, ReportDefinition>;

const pad = (value: number) => String(value).padStart(2, "0");
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Whether from..to (YYYY-MM-DD) is exactly one calendar year. */
export const isWholeYear = (from: string, to: string) => from.endsWith("-01-01") && to === `${from.slice(0, 4)}-12-31`;
/** Whether from..to (YYYY-MM-DD) is exactly one calendar month. */
export function isWholeMonth(from: string, to: string): boolean {
  const [year, month] = from.split("-").map(Number);
  return from.endsWith("-01") && to === `${from.slice(0, 7)}-${pad(lastDay(year, month))}`;
}

/** The report period that contains `today` (YYYY-MM-DD): its month, its half-month pay period, or its year. */
export function suggestedPeriod(kind: ReportKind, today: string): { from: string; to: string } {
  const [year, month, day] = today.split("-").map(Number);
  const prefix = `${year}-${pad(month)}`;
  switch (reportCatalog[kind].period) {
    case "month": return { from: `${prefix}-01`, to: `${prefix}-${pad(lastDay(year, month))}` };
    case "pay-period": return day <= 15 ? { from: `${prefix}-01`, to: `${prefix}-15` } : { from: `${prefix}-16`, to: `${prefix}-${pad(lastDay(year, month))}` };
    case "year": return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
}

/**
 * Facts a report can use from one log. Keys shared with the log-form catalog mean the same thing
 * there, except `product`, which is always a material applied: a harvested, planted or seeded
 * crop recorded as `product` is filed under `commodity`.
 */
export const reportFactKeys = [
  "commodity", "variety", "product", "amount", "unit", "applicationRate", "applicationMethod", "epaRegNumber",
  "targetPest", "areaCovered", "areaUnit", "equipmentUsed", "irrigationMethod", "waterSource", "destination",
  "lotNumber", "nitrogenPercent", "weather", "preHarvestDays", "reentryHours", "pestControlBusiness",
] as const;
export type ReportFactKey = (typeof reportFactKeys)[number];
export const numericReportFacts: ReadonlySet<ReportFactKey> = new Set<ReportFactKey>(["amount", "areaCovered", "nitrogenPercent", "preHarvestDays", "reentryHours"]);

/**
 * Why a required value is blank, shown where the value belongs. `log`: the worker's log does not
 * say it. `records`: Toph does not hold it; `source` names where it comes from instead (for
 * example "payroll" or "FSA"). `note` is the full explanation.
 */
export type ReportMissing = { from: "log" | "records"; source?: string; note: string };
/**
 * A value on a report. `quote` holds the log's own words when the value was detected rather than
 * recorded. A required value that is blank carries `missing`; an optional blank has neither.
 */
export type ReportCell = { value: string | number | null; quote?: string; missing?: ReportMissing };
export type ReportRow = { cells: ReportCell[]; logIds: string[] };
/** `missing` marks a whole section Toph does not hold, such as water test results. */
export type ReportSection = { title: string; note?: string; columns: string[]; rows: ReportRow[]; emptyText: string; missing?: ReportMissing };
export type ReportHeaderField = { label: string; cell: ReportCell };
/** A required item no record states. `logIds` are the records it is missing from; empty for farm-level items. */
export type ReportGap = { label: string; detail: string; logIds: string[] };
/** `missing` counts the marked blanks in the document (version 2 and later). */
export type ReportReadiness = { status: "ready" | "incomplete" | "no-records"; message: string; missing?: number };

export type ReportDocument = {
  /** 1: blanks are plain nulls. 2: required blanks carry `missing`. */
  version: 1 | typeof REPORT_DOCUMENT_VERSION;
  kind: ReportKind;
  form: Omit<ReportDefinition, "name" | "description" | "period">;
  farm: { name: string; timezone: string };
  period: { from: string; to: string };
  generatedAt: string;
  /** `ai`: facts were also detected in log notes. `recorded`: only saved log values were used. */
  detection: { method: "ai" | "recorded"; model: string | null; logsRead: number; factsDetected: number };
  header: ReportHeaderField[];
  sections: ReportSection[];
  gaps: ReportGap[];
  readiness: ReportReadiness;
};

/** Longest period one report covers: a crop year with room for a late harvest. */
export const MAX_REPORT_DAYS = 400;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");

/** POST /api/reports body. */
export const createReportRequestSchema = z.object({
  kind: z.enum(reportKinds),
  name: z.string().trim().min(1, "Give your report a name.").max(160),
  from: isoDate,
  to: isoDate,
}).strict().refine(body => body.to >= body.from, { message: "End date must be on or after the start date.", path: ["to"] });
export type CreateReportRequest = z.infer<typeof createReportRequestSchema>;

export type SavedReportSummary = {
  id: string; kind: ReportKind; name: string; from: string; to: string;
  createdAt: string; createdBy: string | null; readiness: ReportReadiness;
};
export type SavedReportDto = SavedReportSummary & { document: ReportDocument };
export type ReportListResponse = { data: SavedReportSummary[] };
export type ReportResponse = { data: SavedReportDto };
