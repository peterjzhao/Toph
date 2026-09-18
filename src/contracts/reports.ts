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

export const REPORT_DOCUMENT_VERSION = 1 as const;

export const reportKinds = ["pesticide-use", "food-safety", "harvest-traceability", "labor-hours", "organic", "acreage", "nitrogen"] as const;
export type ReportKind = (typeof reportKinds)[number];

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
};

export const reportCatalog = {
  "pesticide-use": {
    name: "Pesticide Use Report",
    description: "Monthly pesticide applications for the county",
    formTitle: "Production Agricultural Pesticide Use Report",
    authority: "California DPR · 3 CCR §§ 6626–6627",
    recipient: "County Agricultural Commissioner",
    cadence: "Monthly, due the 10th of the following month",
    sourceUrl: "https://www.cdpr.ca.gov/wp-content/uploads/2026/04/volume_1_chapter_4.pdf",
  },
  "food-safety": {
    name: "Food Safety Audit",
    description: "Spray, harvest, and water records for a GAP audit",
    formTitle: "Harmonized GAP Records Packet",
    authority: "USDA Harmonized GAP",
    recipient: "Third-party food safety auditor",
    cadence: "At each audit, usually yearly",
    sourceUrl: "https://www.ams.usda.gov/services/auditing/gap-ghp/harmonized",
  },
  "harvest-traceability": {
    name: "Harvest Traceability",
    description: "Trace each harvest to its field, date, and buyer",
    formTitle: "Harvesting Key Data Elements",
    authority: "FDA Food Traceability Rule · 21 CFR 1.1325(a)",
    recipient: "Initial packer; FDA within 24 hours on request",
    cadence: "Every harvest, and for mock recalls",
    sourceUrl: "https://www.law.cornell.edu/cfr/text/21/1.1325",
  },
  "labor-hours": {
    name: "Labor Hours",
    description: "Daily hours per worker for payroll and H-2A",
    formTitle: "Worker Hours Record",
    authority: "H-2A · 20 CFR 655.122(j)–(k)",
    recipient: "Payroll; DOL Wage and Hour on request",
    cadence: "Every pay period",
    sourceUrl: "https://www.law.cornell.edu/cfr/text/20/655.122",
  },
  organic: {
    name: "Organic Records",
    description: "Inputs and field activities for organic inspection",
    formTitle: "Input Application and Field Activity Log",
    authority: "USDA National Organic Program · 7 CFR 205.103",
    recipient: "Organic certifier",
    cadence: "Yearly inspection; keep for 5 years",
    sourceUrl: "https://www.law.cornell.edu/cfr/text/7/205.103",
  },
  acreage: {
    name: "Acreage Report",
    description: "Planted acres by field and crop for FSA",
    formTitle: "Report of Acreage (FSA-578)",
    authority: "USDA Farm Service Agency",
    recipient: "County FSA office",
    cadence: "By each crop's deadline, often July 15",
    sourceUrl: "https://www.fsa.usda.gov/sites/default/files/2025-03/FSA-578.pdf",
  },
  nitrogen: {
    name: "Nitrogen Summary",
    description: "Nitrogen applied and yield per field for your coalition",
    formTitle: "Irrigation and Nitrogen Management Plan Summary Report",
    authority: "California Irrigated Lands Regulatory Program",
    recipient: "Water quality coalition",
    cadence: "Yearly, per crop year",
    sourceUrl: "https://wwd.ca.gov/wp-content/uploads/2019/11/inmp-worksheet-instructions.pdf",
  },
} as const satisfies Record<ReportKind, ReportDefinition>;

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

/** A value on a report. `quote` holds the log's own words when the value was detected rather than recorded. */
export type ReportCell = { value: string | number | null; quote?: string };
export type ReportRow = { cells: ReportCell[]; logIds: string[] };
export type ReportSection = { title: string; note?: string; columns: string[]; rows: ReportRow[]; emptyText: string };
export type ReportHeaderField = { label: string; cell: ReportCell };
/** A required item no record states. `logIds` are the records it is missing from; empty for farm-level items. */
export type ReportGap = { label: string; detail: string; logIds: string[] };
export type ReportReadiness = { status: "ready" | "incomplete" | "no-records"; message: string };

export type ReportDocument = {
  version: typeof REPORT_DOCUMENT_VERSION;
  kind: ReportKind;
  form: Omit<ReportDefinition, "name" | "description">;
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
