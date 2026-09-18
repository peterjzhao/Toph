/**
 * Which Sentinel-2 pass the Map page shows.
 *
 * The slider has one stop per clear pass and a final stop for today, which shows the farm's own
 * saved aerial rather than a pass. A date picked on the calendar lands on the nearest pass, the
 * earlier one on a tie, so a chosen day never shows imagery from further away than it has to.
 */
export type SatellitePass = { date: string; cloudCover: number };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/**
 * Slider index for a calendar date: the nearest pass, or `passes.length` — the saved map — for
 * today, any later date, an empty picker, or a farm with no passes. `passes` must be oldest first.
 */
export function passIndexForDate(passes: readonly SatellitePass[], date: string, today: string): number {
  if (!passes.length || !ISO_DATE.test(date) || date >= today) return passes.length;
  let low = 0, high = passes.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (passes[middle].date < date) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return 0;
  if (low === passes.length) return passes.length - 1;
  const target = dayNumber(date);
  const before = target - dayNumber(passes[low - 1].date), after = dayNumber(passes[low].date) - target;
  return after < before ? low : low - 1;
}
