/**
 * Contract v2 between the Toph backend and the dashboard UI.
 *
 * Plain, JSON-serializable TypeScript types only. This module is safe to import from browser
 * code: no database clients, environment reads, or server-only imports belong here.
 *
 * v2 changes from v1: `recording` lost `isDemo` and `waveformSource`; `metrics` lost `source`
 * and is computed from the farm's data; `meta` lost `mode` and `demoReferenceDate`; periods
 * are `all` (default), `this-month`, and `custom`. v2.1 adds `employee.avatarUrl` (additive).
 */

export const DASHBOARD_CONTRACT_VERSION = "2" as const;

export type TagDto = { id: string; label: string };

export type LogDto = {
  id: string;
  employee: { id: string; name: string; avatarUrl: string | null };
  activity: string;
  date: string; // YYYY-MM-DD, business date; UI formats it as April 19, 2026
  field: { id: string; name: string; mapImageUrl: string | null };
  startAt: string; // ISO-8601 timestamp including offset or Z
  endAt: string;
  summary: string;
  isNew: boolean;
  recording: {
    url: string;
    durationSeconds: number | null;
    waveformAssetUrl: string | null;
    waveformPeaks: number[] | null;
  } | null;
  tags: TagDto[];
  updatedAt: string;
};

export type DashboardData = {
  farm: {
    id: string;
    name: string;
    avatarUrl: string | null;
    timezone: string;
  };
  metrics: {
    recordingsToday: number; // logs dated today in the farm timezone
    newRecordings: number; // of those, logs still flagged new
    activeWorkers: number; // employees with is_active
    responseAccuracy: number | null; // null until a source for this measure exists
    asOf: string; // YYYY-MM-DD, today in the farm timezone
  };
  newLogCount: number; // New records matching the current filters, before pagination
  logs: LogDto[];
  filterOptions: {
    activities: string[];
    fields: Array<{ id: string; name: string }>;
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
