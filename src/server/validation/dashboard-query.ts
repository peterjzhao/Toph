import { z } from "zod";
import type { DashboardPeriod, DashboardQuery, DashboardSort } from "@/contracts/dashboard";
import { validationError } from "@/server/errors";
import { isValidCalendarDate } from "@/server/time/zoned";

export const DASHBOARD_QUERY_LIMITS = {
  qMaxLength: 200,
  maxListValues: 25,
  defaultLimit: 50,
  maxLimit: 100,
  maxOffset: 100_000,
} as const;

export type ParsedDashboardQuery = {
  q: string | undefined;
  activities: string[];
  fieldIds: string[];
  period: DashboardPeriod;
  from: string | undefined;
  to: string | undefined;
  sort: DashboardSort;
  limit: number;
  offset: number;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a calendar date in YYYY-MM-DD form")
  .refine(isValidCalendarDate, "must be a real calendar date");

const listLimit = `at most ${DASHBOARD_QUERY_LIMITS.maxListValues} values`;

const querySchema = z
  .object({
    q: z
      .string()
      .max(DASHBOARD_QUERY_LIMITS.qMaxLength, `must be at most ${DASHBOARD_QUERY_LIMITS.qMaxLength} characters`)
      .optional(),
    activities: z
      .array(z.string().trim().min(1, "must not be blank").max(100, "must be at most 100 characters"))
      .max(DASHBOARD_QUERY_LIMITS.maxListValues, listLimit)
      .optional(),
    fieldIds: z
      .array(z.string().regex(UUID_PATTERN, "must be a UUID").transform((v) => v.toLowerCase()))
      .max(DASHBOARD_QUERY_LIMITS.maxListValues, listLimit)
      .optional(),
    period: z.enum(["all", "this-month", "custom"], { error: "must be one of all, this-month, custom" }).optional(),
    from: calendarDate.optional(),
    to: calendarDate.optional(),
    sort: z
      .enum(["date-asc", "date-desc", "employee-asc", "activity-asc"], {
        error: "must be one of date-asc, date-desc, employee-asc, activity-asc",
      })
      .optional(),
    limit: z
      .number({ error: "must be a whole number" })
      .int("must be a whole number")
      .min(1, `must be between 1 and ${DASHBOARD_QUERY_LIMITS.maxLimit}`)
      .max(DASHBOARD_QUERY_LIMITS.maxLimit, `must be between 1 and ${DASHBOARD_QUERY_LIMITS.maxLimit}`)
      .optional(),
    offset: z
      .number({ error: "must be a whole number" })
      .int("must be a whole number")
      .min(0, `must be between 0 and ${DASHBOARD_QUERY_LIMITS.maxOffset}`)
      .max(DASHBOARD_QUERY_LIMITS.maxOffset, `must be between 0 and ${DASHBOARD_QUERY_LIMITS.maxOffset}`)
      .optional(),
  })
  .strict();

type Validation = { value: ParsedDashboardQuery | null; fields: Record<string, string> };

function runValidation(input: DashboardQuery): Validation {
  const fields: Record<string, string> = {};
  const candidate: DashboardQuery = { ...input };
  if (typeof candidate.q === "string") {
    const trimmed = candidate.q.trim();
    if (trimmed.length === 0) delete candidate.q;
    else candidate.q = trimmed;
  }

  const result = querySchema.safeParse(candidate);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = String(issue.path[0] ?? "query");
      fields[field] ??= issue.message;
    }
    return { value: null, fields };
  }

  const value = result.data;
  const period: DashboardPeriod = value.period ?? "all";
  if (period === "custom") {
    if (!value.from) fields.from ??= "is required when period is custom";
    if (!value.to) fields.to ??= "is required when period is custom";
    if (value.from && value.to && value.from > value.to) fields.from ??= "must not be after to";
  } else {
    if (value.from !== undefined) fields.from ??= "is only allowed when period is custom";
    if (value.to !== undefined) fields.to ??= "is only allowed when period is custom";
  }
  if (Object.keys(fields).length > 0) return { value: null, fields };

  return {
    fields,
    value: {
      q: value.q,
      activities: value.activities ?? [],
      fieldIds: value.fieldIds ?? [],
      period,
      from: value.from,
      to: value.to,
      sort: value.sort ?? "date-asc",
      limit: value.limit ?? DASHBOARD_QUERY_LIMITS.defaultLimit,
      offset: value.offset ?? 0,
    },
  };
}

/** Validates a DashboardQuery object (service entry point). Throws a 400 ApiError naming each bad field. */
export function validateDashboardQuery(input: DashboardQuery = {}): ParsedDashboardQuery {
  const { value, fields } = runValidation(input);
  if (!value) throw validationError("Invalid dashboard query.", fields);
  return value;
}

const REPEATABLE_PARAMS: Record<string, "activities" | "fieldIds"> = { activity: "activities", fieldId: "fieldIds" };
const SCALAR_PARAMS = new Set(["q", "period", "from", "to", "sort", "limit", "offset"]);
const OBJECT_TO_PARAM: Record<string, string> = { activities: "activity", fieldIds: "fieldId" };

/**
 * Validates the GET /api/dashboard query string. Unknown parameters (including any farm
 * selector), repeated scalars, and out-of-range values are rejected with a 400 whose
 * `fields` object names each offending query parameter.
 */
export function parseDashboardQuery(searchParams: URLSearchParams): ParsedDashboardQuery {
  const fields: Record<string, string> = {};
  const input: DashboardQuery = {};

  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    if (key in REPEATABLE_PARAMS) {
      input[REPEATABLE_PARAMS[key]] = values;
    } else if (SCALAR_PARAMS.has(key)) {
      if (values.length > 1) {
        fields[key] = "must not be repeated";
        continue;
      }
      const value = values[0];
      if (key === "limit" || key === "offset") {
        if (!/^(0|[1-9]\d*)$/.test(value)) fields[key] = "must be a whole number";
        else input[key] = Number(value);
      } else {
        (input as Record<string, string>)[key] = value;
      }
    } else {
      fields[key] = "unknown parameter";
    }
  }

  const validation = runValidation(input);
  for (const [objectField, message] of Object.entries(validation.fields)) {
    const param = OBJECT_TO_PARAM[objectField] ?? objectField;
    fields[param] ??= message;
  }
  if (Object.keys(fields).length > 0 || !validation.value) {
    throw validationError("Invalid dashboard query.", fields);
  }
  return validation.value;
}
