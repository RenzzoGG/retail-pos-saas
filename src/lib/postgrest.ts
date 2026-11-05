/**
 * User text used inside PostgREST `or=(...)` filters (values are double-quoted). Commas, parentheses
 * and quotes are part of that syntax, and %, _ and * are wildcards, so they are
 * replaced by spaces: a search can never change the filter's meaning.
 */
export function escapeSearchTerm(input: string, maxLength = 64): string {
  return input
    .replace(/[%_*\\"(),]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
