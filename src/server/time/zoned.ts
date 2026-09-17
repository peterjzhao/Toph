/**
 * Minimal IANA time zone helpers built on Intl, used to turn farm-local wall times into
 * unambiguous instants (and back to business dates) without a date library.
 */

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** True for a real proleptic-Gregorian calendar date written as YYYY-MM-DD. */
export function isValidCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  // Throws RangeError for an unknown time zone, which callers treat as invalid input.
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function wallClockIn(formatter: Intl.DateTimeFormat, instant: Date): WallClock {
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour === 24 ? 0 : parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function wallClockAsUtcMs(w: WallClock): number {
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (positive east of UTC). */
function offsetMs(formatter: Intl.DateTimeFormat, instant: Date): number {
  return wallClockAsUtcMs(wallClockIn(formatter, instant)) - instant.getTime();
}

/**
 * Converts a wall-clock date and time in `timeZone` to the corresponding instant.
 * Throws for malformed input, unknown zones, and wall times that do not exist (DST gaps).
 */
export function localDateTimeToInstant(date: string, time: string, timeZone: string): Date {
  if (!isValidCalendarDate(date)) throw new Error(`Invalid calendar date: ${date}`);
  const timeMatch = TIME_PATTERN.exec(time);
  if (!timeMatch) throw new Error(`Invalid time: ${time}`);
  const [, hh, mm, ss = "0"] = timeMatch;
  const hour = Number(hh);
  const minute = Number(mm);
  const second = Number(ss);
  if (hour > 23 || minute > 59 || second > 59) throw new Error(`Invalid time: ${time}`);

  const formatter = formatterFor(timeZone);
  const [year, month, day] = date.split("-").map(Number);
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);

  // Two passes converge for every fixed-offset and DST transition case; a wall time inside a
  // DST gap fails the round-trip check below.
  let instant = wallAsUtc - offsetMs(formatter, new Date(wallAsUtc));
  instant = wallAsUtc - offsetMs(formatter, new Date(instant));

  const roundTrip = wallClockAsUtcMs(wallClockIn(formatter, new Date(instant)));
  if (roundTrip !== wallAsUtc) {
    throw new Error(`Wall time ${date} ${time} does not exist in ${timeZone}`);
  }
  return new Date(instant);
}

/** The calendar date (YYYY-MM-DD) of `instant` as observed in `timeZone`. */
export function instantToLocalDate(instant: Date, timeZone: string): string {
  const w = wallClockIn(formatterFor(timeZone), instant);
  return `${String(w.year).padStart(4, "0")}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}
