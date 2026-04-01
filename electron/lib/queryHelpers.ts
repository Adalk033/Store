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
  // Escape backslashes first, then SQL LIKE special characters
  const escapeBackslashes = normalized.replace(/\\/g, '\\\\');
  const escaped = escapeBackslashes.replace(/[%_]/g, '\\$&');
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

// --- Cursor/keyset pagination helpers (Phase 5) ---

/**
 * Cursor separator used in encoded tokens.
 */
const CURSOR_SEPARATOR = '|';

/**
 * Encode a (created_at, id) pair into an opaque cursor token.
 */
export function encodeCursor(createdAt: string, id: number): string {
  return `${createdAt}${CURSOR_SEPARATOR}${id}`;
}

/**
 * Decode a cursor token back into (created_at, id).
 * Returns null if the token is invalid.
 */
export function decodeCursor(cursor: string): { createdAt: string; id: number } | null {
  if (!cursor || typeof cursor !== 'string') return null;

  const sepIndex = cursor.lastIndexOf(CURSOR_SEPARATOR);
  if (sepIndex < 1) return null;

  const createdAt = cursor.slice(0, sepIndex);
  const idStr = cursor.slice(sepIndex + 1);
  const id = Number(idStr);

  if (!Number.isInteger(id) || id < 1) return null;
  // created_at format: "YYYY-MM-DD HH:MM:SS" (19 chars)
  if (createdAt.length < 10 || createdAt.length > 26) return null;

  return { createdAt, id };
}

/**
 * Sanitize cursor pagination parameters.
 */
export function sanitizeCursorPagination(pageSize: unknown): number {
  const MIN = 1;
  const MAX = 200;
  const DEFAULT = 50;

  let safe = typeof pageSize === 'number' && Number.isInteger(pageSize) ? pageSize : DEFAULT;
  if (safe < MIN) safe = MIN;
  if (safe > MAX) safe = MAX;
  return safe;
}

/**
 * Build keyset WHERE clause for DESC ordering (created_at DESC, id DESC).
 * Returns the SQL fragment and parameters to append.
 */
export function buildCursorWhereDesc(
  cursor: string | undefined,
  tableAlias: string
): { sql: string; params: unknown[] } {
  if (!cursor) return { sql: '', params: [] };

  const decoded = decodeCursor(cursor);
  if (!decoded) return { sql: '', params: [] };

  return {
    sql: `(${tableAlias}.created_at < ? OR (${tableAlias}.created_at = ? AND ${tableAlias}.id < ?))`,
    params: [decoded.createdAt, decoded.createdAt, decoded.id],
  };
}

/**
 * Build keyset WHERE clause for ASC ordering (created_at ASC, id ASC).
 */
export function buildCursorWhereAsc(
  cursor: string | undefined,
  tableAlias: string
): { sql: string; params: unknown[] } {
  if (!cursor) return { sql: '', params: [] };

  const decoded = decodeCursor(cursor);
  if (!decoded) return { sql: '', params: [] };

  return {
    sql: `(${tableAlias}.created_at > ? OR (${tableAlias}.created_at = ? AND ${tableAlias}.id > ?))`,
    params: [decoded.createdAt, decoded.createdAt, decoded.id],
  };
}

// --- Idempotency key helpers (Phase 5) ---

/**
 * Generate a UUID v4 idempotency key.
 * Uses crypto.randomUUID() which is available in Node.js 19+.
 */
export function generateIdempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * Validate that a value looks like a UUID v4 idempotency key.
 */
export function isValidIdempotencyKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}
