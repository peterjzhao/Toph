export type DatePreset = "today" | "this-week" | "this-month" | "last-month" | "all";
export type DateFilter = { kind: DatePreset } | { kind: "month"; month: string } | { kind: "custom"; from: string; to: string };
export type DateRange = { from: string; to: string };

const iso = (date: Date) => date.toISOString().slice(0, 10);
const calendarDate = (date: string) => new Date(`${date}T12:00:00Z`);

export function monthRange(month: string): DateRange {
  const start = calendarDate(`${month}-01`);
  return { from: iso(start), to: iso(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 12))) };
}

// Business dates are compared as calendar dates, so DST never adds or removes a day.
export function dateRange(filter: DateFilter, today: string): DateRange | null {
  switch (filter.kind) {
    case "all": return null;
    case "custom": return { from: filter.from, to: filter.to };
    case "month": return monthRange(filter.month);
    case "today": return { from: today, to: today };
    case "this-month": return monthRange(today.slice(0, 7));
    case "last-month": {
      const date = calendarDate(`${today.slice(0, 7)}-01`);
      date.setUTCMonth(date.getUTCMonth() - 1);
      return monthRange(iso(date).slice(0, 7));
    }
    case "this-week": {
      const start = calendarDate(today);
      start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
      const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
      return { from: iso(start), to: iso(end) };
    }
  }
}

export function initialDateFilter(dates: string[], today: string): DateFilter {
  if (!dates.length || dates.some(date => date.slice(0, 7) === today.slice(0, 7))) return { kind: "this-month" };
  // Keep historical records discoverable without calling an old month “This Month”.
  return { kind: "month", month: [...dates].sort().at(-1)!.slice(0, 7) };
}

export function dateFilterLabel(filter: DateFilter): string {
  if (filter.kind === "month") return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(calendarDate(`${filter.month}-01`));
  if (filter.kind === "custom") return "Custom Range";
  return { today: "Today", "this-week": "This Week", "this-month": "This Month", "last-month": "Last Month", all: "All Time" }[filter.kind];
}

export function rangeDescription(range: DateRange | null): string {
  if (!range) return "All recorded dates";
  const format = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(calendarDate(value));
  return range.from === range.to ? format(range.from) : `${format(range.from)} – ${format(range.to)}`;
}

export function validDateRange(from: string, to: string): boolean {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(calendarDate(value).getTime()) && iso(calendarDate(value)) === value;
  return valid(from) && valid(to) && from <= to;
}
