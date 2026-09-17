import type { TranscriptionResult } from "@toph/contracts/transcription";
export const emptyExtraction = { fieldId: null, activity: null, workDate: null, startTime: null, endTime: null, notes: null, product: null, amount: null, unit: null, tags: [] };
export const transcriptResult = (text: string, transcript = text): TranscriptionResult => ({ text, transcript, fields: { ...emptyExtraction }, missingFields: [], extractionError: null });
export const transcriptionContext = { accountId: "10000000-0000-4000-8000-000000000001", referenceDate: "2026-09-16" };
