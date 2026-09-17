/**
 * Prepared mobile submission contract. The route is deliberately disabled for now.
 * Type-only imports are safe in Expo; never import src/server from the mobile app.
 */
export type MobileLogSubmission = {
  contractVersion: "1";
  /** Stable device draft UUID. The server must deduplicate within the authenticated account. */
  clientDraftId: string;
  /** Field selected from the authenticated farm's future field catalog. */
  fieldId: string;
  activity: string;
  /** Farm-local date and wall-clock times, NOT converted using the phone's timezone. */
  workDate: string;
  startTime: string;
  endTime: string;
  notes: string;
  transcript: string | null;
  treatment: { product: string | null; amount: number | null; unit: string | null } | null;
  tags: string[];
  recording: { mimeType: string; durationSeconds: number } | null;
};

/** Returned only after a real commit; a disabled server must never return a fake receipt. */
export type MobileLogReceipt = {
  clientDraftId: string;
  /** The same work-log UUID used by the dashboard's collapsed and expanded row. */
  logId: string;
  savedAt: string;
};

export type MobileLogResponse = { data: MobileLogReceipt };
