import { validationError } from "@/server/errors";

export const TAG_LABEL_MAX_LENGTH = 40;
export const MAX_TAGS_PER_LOG = 10;

// C0 controls (including tab and newline), DEL, and C1 controls.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

export type NormalizedTagLabel = {
  /** Readable label as stored and displayed: NFC, trimmed, single-spaced, original casing. */
  label: string;
  /** Lowercase uniqueness key used for case-insensitive matching within a farm. */
  normalizedLabel: string;
};

/**
 * Normalizes a user-supplied tag label: rejects control characters, applies Unicode NFC,
 * trims, collapses internal whitespace, and enforces 1–40 characters after normalization.
 * Throws a 400 ApiError describing the problem.
 */
export function normalizeTagLabel(input: unknown): NormalizedTagLabel {
  if (typeof input !== "string") {
    throw validationError("Tag label must be a string.", { label: "must be a string" });
  }
  if (CONTROL_CHARACTERS.test(input)) {
    throw validationError("Tag label must not contain control characters.", {
      label: "control characters are not allowed",
    });
  }

  const label = input.normalize("NFC").trim().replace(/\s+/g, " ");
  const length = Array.from(label).length;
  if (length < 1 || length > TAG_LABEL_MAX_LENGTH) {
    throw validationError(`Tag label must be between 1 and ${TAG_LABEL_MAX_LENGTH} characters after trimming.`, {
      label: length < 1 ? "must not be empty" : `must be at most ${TAG_LABEL_MAX_LENGTH} characters`,
    });
  }

  return { label, normalizedLabel: label.toLowerCase() };
}
