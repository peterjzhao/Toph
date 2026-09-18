/**
 * Response accuracy: of the logs an admin has decided on in Audit Manager, the share approved
 * rather than flagged, rounded to the nearest 10. Pending logs don't count either way, and a farm
 * with no decisions yet has no score.
 */
export function responseAccuracy(approved: number, flagged: number): number | null {
  const decided = approved + flagged;
  if (decided <= 0) return null;
  return Math.round(approved / decided * 10) * 10;
}
