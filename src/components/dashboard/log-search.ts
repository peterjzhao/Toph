import { formatDate, formatTime } from "../../lib/format";
import type { EmployeeLog } from "./types";

const questionWords = new Set(["who", "what", "when", "where", "why", "how", "which", "whose", "did", "do", "does", "is", "are", "was", "were", "has", "have", "had", "can", "could", "should", "will", "would"]);
const requestWords = new Set(["show", "list", "summarize", "summarise", "tell", "compare", "find", "give", "count", "explain"]);

/**
 * Whether a search box entry reads as a question for Toph rather than keywords. Deliberately
 * conservative: short entries such as "is" or "show" stay keyword searches.
 */
export function isFarmQuestion(query: string): boolean {
  const text = query.trim();
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  if (text.endsWith("?")) return true;
  const first = words[0].replace(/[^a-z]/g, "");
  return words.length >= 3 && (questionWords.has(first) || requestWords.has(first));
}

/** Text a keyword search may match: the visible row plus its summary and tags (not transcripts). */
export function logSearchText(log: EmployeeLog, tags: string[], timezone?: string): string {
  return [
    log.employee.name, log.activity, log.field.name, formatDate(log.date),
    formatTime(log.startAt, timezone), formatTime(log.endAt, timezone), log.summary, ...tags,
  ].join(" ").toLowerCase();
}

/** Every word of the query must appear somewhere in the log, in any order. */
export function matchesSearch(text: string, query: string): boolean {
  return query.toLowerCase().split(/\s+/).filter(Boolean).every(word => text.includes(word));
}
