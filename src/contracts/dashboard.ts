/**
 * Contract v2 between the Toph backend and the dashboard UI.
 *
 * Plain, JSON-serializable TypeScript types only. This module is safe to import from browser
 * code: no database clients, environment reads, or server-only imports belong here.
 *
 * v2 changes from v1: `recording` lost its sample-media flag and `waveformSource`; `metrics` lost `source`
 * and is computed from the farm's data; `meta` lost `mode` and its fixed reference date; periods
 * are `all` (default), `this-month`, and `custom`. v2.1 adds `employee.avatarUrl` (additive).
 * v2.2 adds `LogDto.details` and `PATCH /api/logs/:logId` (additive). v2.3 removes
 * `recording.waveformPeaks` and `farm.avatarUrl`, which no client read.
 */
import type { LogDetailValue, LogDetails } from "./log-form";

export const DASHBOARD_CONTRACT_VERSION = "2" as const;

export type TagDto = { id: string; label: string };
export type DashboardFieldDto = { id: string; name: string; mapImageUrl?: string | null; boundary?: Array<{ x: number; y: number }> };

export type LogDto = {
  id: string;
  employee: { id: string; name: string; avatarUrl: string | null };
  activity: string;
  date: string; // YYYY-MM-DD, business date; UI formats it as April 19, 2026
  field: DashboardFieldDto & { mapImageUrl: string | null };
  startAt: string; // ISO-8601 timestamp including offset or Z
  endAt: string;
  summary: string;
  isNew: boolean;
  recording: {
    url: string;
    durationSeconds: number | null;
    waveformAssetUrl: string | null;
    /** Present for mobile logs with appended recordings, in capture order. */
    clips?: Array<{ url: string; durationSeconds: number }>;
  } | null;
  tags: TagDto[];
  /** Activity-specific values keyed by the log form (`resolveLogForm` in ./log-form). */
  details: LogDetails;
  updatedAt: string;
};

export type DashboardData = {
  farm: {
    id: string;
    name: string;
    timezone: string;
  };
  metrics: {
    recordingsToday: number; // logs that arrived on asOf, whatever day the work was done
    newRecordings: number; // of those, logs still flagged new
    activeWorkers: number; // employees with is_active plus the farm's administrator account
    responseAccuracy: number | null; // approved ÷ (approved + flagged) audit decisions, nearest 10; null with no decisions
    asOf: string; // YYYY-MM-DD, the farm's today: its Settings demo day, or the real date in the farm timezone
  };
  newLogCount: number; // New records matching the current filters, before pagination
  logs: LogDto[];
  filterOptions: {
    activities: string[];
    fields: DashboardFieldDto[];
  };
};

export type DashboardQuery = {
  q?: string;
  activities?: string[];
  fieldIds?: string[];
  period?: "all" | "this-month" | "custom";
  from?: string;
  to?: string;
  sort?: "date-asc" | "date-desc" | "employee-asc" | "activity-asc";
  limit?: number;
  offset?: number;
};

export type DashboardPeriod = NonNullable<DashboardQuery["period"]>;
export type DashboardSort = NonNullable<DashboardQuery["sort"]>;

/** The filters the server actually applied, echoed back so the UI can render its state. */
export type DashboardAppliedFilters = {
  q: string | null;
  activities: string[];
  fieldIds: string[];
  period: DashboardPeriod;
  /** Inclusive business-date bounds applied to work_date, or null when period is "all". */
  dateRange: { from: string; to: string } | null;
  sort: DashboardSort;
};

export type DashboardPagination = {
  total: number; // matches after filtering, before pagination
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type DashboardMeta = {
  contractVersion: typeof DASHBOARD_CONTRACT_VERSION;
  filters: DashboardAppliedFilters;
  pagination: DashboardPagination;
};

/** GET /api/dashboard */
export type DashboardResponse = { data: DashboardData; meta: DashboardMeta };

/** GET /api/logs/:logId */
export type LogResponse = { data: LogDto };

/** PATCH /api/logs/:logId request body: listed keys are replaced, null clears one, others are kept. */
export type UpdateLogRequest = { details: Record<string, LogDetailValue> };

/** GET /api/tags */
export type TagsResponse = { data: TagDto[] };

/** POST /api/logs/:logId/tags and DELETE /api/logs/:logId/tags/:tagId */
export type LogTagsResponse = { data: { logId: string; tags: TagDto[] } };

/** POST /api/logs/:logId/tags request body */
export type AddTagRequest = { label: string };

/** GET /api/health */
export type HealthResponse = { data: { status: "ok"; database: "connected" } };

export type ApiErrorResponse = {
  error: { code: string; message: string; fields?: Record<string, string> };
};
