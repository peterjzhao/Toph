/**
 * Bays Ranch's premade April 2026 reports, prepared once by scripts/db/build-sample-reports.ts
 * with the same code as POST /api/reports and then frozen. Migration 0014 inserts these rows into
 * databases that already hold Bays Ranch; the seed inserts them into new ones. A unit test keeps
 * the migration and this data identical.
 */
import type { ReportDocument, ReportKind } from "@/contracts/reports";
import data from "./sample-reports.json";

export type SampleReport = {
  id: string; kind: ReportKind; name: string; from: string; to: string;
  createdAt: string; createdBy: string; document: ReportDocument;
};

export const SAMPLE_REPORTS = data as unknown as readonly SampleReport[];
