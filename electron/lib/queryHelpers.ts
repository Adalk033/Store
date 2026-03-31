/**
 * Text search normalization utilities for server-side filtering.
 * Convention: case-insensitive, accent-stripped, trimmed, contains matching.
 */

/**
 * Remove diacritical marks (accents) from a string.
 * Uses Unicode NFD decomposition to separate base characters from combining marks.
 */
export function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Normalize a search term for comparison:
 * - Trim leading/trailing whitespace
 * - Convert to lowercase
 * - Remove accents/diacritics
 */
export function normalizeSearchTerm(term: string): string {
  return stripAccents(term.trim().toLowerCase());
}

/**
 * Build a SQLite LIKE pattern for contains matching.
 * The returned value is already wrapped with % wildcards.
 * Escapes any literal % or _ in the search term.
 */
export function buildLikePattern(term: string): string {
  const normalized = normalizeSearchTerm(term);
  // Escape SQL LIKE special characters
  const escaped = normalized.replace(/[%_]/g, '\\$&');
  return `%${escaped}%`;
}

/**
 * Validate and sanitize pagination parameters.
 * Ensures page >= 1 and pageSize is within safe bounds.
 */
export function sanitizePagination(page: unknown, pageSize: unknown): { page: number; pageSize: number } {
  const MIN_PAGE = 1;
  const MIN_PAGE_SIZE = 1;
  const MAX_PAGE_SIZE = 200;
  const DEFAULT_PAGE_SIZE = 50;

  let safePage = typeof page === 'number' && Number.isInteger(page) ? page : MIN_PAGE;
  let safePageSize = typeof pageSize === 'number' && Number.isInteger(pageSize) ? pageSize : DEFAULT_PAGE_SIZE;

  if (safePage < MIN_PAGE) safePage = MIN_PAGE;
  if (safePageSize < MIN_PAGE_SIZE) safePageSize = MIN_PAGE_SIZE;
  if (safePageSize > MAX_PAGE_SIZE) safePageSize = MAX_PAGE_SIZE;

  return { page: safePage, pageSize: safePageSize };
}

/**
 * Validate a date string is in YYYY-MM-DD format.
 */
export function isValidDateFilter(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Validate that a status value is one of the allowed values.
 */
export function isValidStatus(value: unknown, allowed: readonly string[]): value is string {
  return typeof value === 'string' && allowed.includes(value);
}

/**
 * Calculate SQL LIMIT and OFFSET from page and pageSize.
 */
export function calcLimitOffset(page: number, pageSize: number): { limit: number; offset: number } {
  return {
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };
}
