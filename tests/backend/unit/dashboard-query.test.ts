import { describe, expect, it } from "vitest";
import { parseDashboardQuery } from "@/server/validation/dashboard-query";
import { ApiError } from "@/server/errors";

function parse(query: string) {
  return parseDashboardQuery(new URLSearchParams(query));
}

function expectValidationError(query: string, field: string) {
  try {
    parse(query);
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(400);
    expect(apiError.code).toBe("VALIDATION_ERROR");
    expect(Object.keys(apiError.fields ?? {})).toContain(field);
    return;
  }
  throw new Error(`expected "${query}" to be rejected on ${field}`);
}

describe("parseDashboardQuery", () => {
  it("applies the documented defaults", () => {
    expect(parse("")).toEqual({
      q: undefined,
      activities: [],
      fieldIds: [],
      period: "all",
      from: undefined,
      to: undefined,
      sort: "date-asc",
      limit: 50,
      offset: 0,
    });
  });

  it("rejects unknown parameters, including a farmId override", () => {
    expectValidationError("farmId=00000000-0000-4000-8000-000000000002", "farmId");
    expectValidationError("unknown=1", "unknown");
  });

  it("trims q, drops blank q, and limits it to 200 characters", () => {
    expect(parse("q=%20%20Isaac%20").q).toBe("Isaac");
    expect(parse("q=%20%20").q).toBeUndefined();
    expect(parse(`q=${"a".repeat(200)}`).q).toHaveLength(200);
    expectValidationError(`q=${"a".repeat(201)}`, "q");
  });

  it("collects repeatable activity and fieldId values with a cap of 25 each", () => {
    const parsed = parse(
      "activity=Spraying&activity=Harvesting&fieldId=20000000-0000-4000-8000-000000000001&fieldId=20000000-0000-4000-8000-000000000002",
    );
    expect(parsed.activities).toEqual(["Spraying", "Harvesting"]);
    expect(parsed.fieldIds).toEqual(["20000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000002"]);
    expectValidationError(Array.from({ length: 26 }, (_, i) => `activity=a${i}`).join("&"), "activity");
    expectValidationError("fieldId=not-a-uuid", "fieldId");
    expectValidationError("activity=", "activity");
  });

  it("validates periods and date bounds", () => {
    expect(parse("period=this-month").period).toBe("this-month");
    expect(parse("period=custom&from=2026-04-01&to=2026-04-15")).toMatchObject({
      period: "custom",
      from: "2026-04-01",
      to: "2026-04-15",
    });
    expect(parse("period=custom&from=2026-04-15&to=2026-04-15").period).toBe("custom");
    expectValidationError("period=custom", "from");
    expectValidationError("period=custom&from=2026-04-01", "to");
    expectValidationError("period=custom&from=2026-04-16&to=2026-04-15", "from");
    expectValidationError("period=custom&from=2026-02-30&to=2026-04-15", "from");
    expectValidationError("period=custom&from=04/01/2026&to=2026-04-15", "from");
    expectValidationError("from=2026-04-01", "from");
    expectValidationError("period=this-month&to=2026-04-01", "to");
    expectValidationError("period=demo-month", "period");
    expectValidationError("period=yesterday", "period");
  });

  it("validates sort against the allowlist", () => {
    for (const sort of ["date-asc", "date-desc", "employee-asc", "activity-asc"]) {
      expect(parse(`sort=${sort}`).sort).toBe(sort);
    }
    expectValidationError("sort=summary", "sort");
    expectValidationError("sort=work_date;drop", "sort");
  });

  it("validates limit and offset as bounded integers", () => {
    expect(parse("limit=1&offset=100000")).toMatchObject({ limit: 1, offset: 100000 });
    expect(parse("limit=100")).toMatchObject({ limit: 100 });
    expectValidationError("limit=0", "limit");
    expectValidationError("limit=101", "limit");
    expectValidationError("limit=abc", "limit");
    expectValidationError("limit=1.5", "limit");
    expectValidationError("offset=-1", "offset");
    expectValidationError("offset=100001", "offset");
  });

  it("rejects duplicated scalar parameters", () => {
    expectValidationError("limit=10&limit=20", "limit");
    expectValidationError("q=a&q=b", "q");
  });
});
