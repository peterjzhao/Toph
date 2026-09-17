/**
 * Escapes the LIKE/ILIKE metacharacters so user input is matched literally.
 * Queries must pair the result with `ESCAPE '\'` (the PostgreSQL default escape character).
 */
export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Builds a case-insensitive "contains" pattern for a literal search term. */
export function containsPattern(term: string): string {
  return `%${escapeLikePattern(term)}%`;
}
