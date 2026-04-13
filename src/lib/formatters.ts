// Formatting utilities for display

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// Parse stored dates into a UTC Date preserving the original calendar day.
// DB values are usually stored as "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS".
// Cloud responses can also come back as ISO-8601 strings with "T" and "Z".
// We handle both without letting the local timezone shift the visible date.
function parseDateStringAsUTC(dateString: string | null | undefined): Date | null {
  if (!dateString || dateString.trim() === '') {
    return null;
  }

  const trimmed = dateString.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(trimmed)) {
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDate(dateString: string | null | undefined): string {
  const date = parseDateStringAsUTC(dateString);
  if (!date) {
    return '-';
  }

  return new Intl.DateTimeFormat('es-MX', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function formatDateTime(dateString: string | null | undefined): string {
  const date = parseDateStringAsUTC(dateString);
  if (!date) {
    return '-';
  }

  return new Intl.DateTimeFormat('es-MX', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(date);
}

export function formatInteger(value: number | string | null | undefined): string {
  // Normalize value to number
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return '0';
  }

  return new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(parsed));
}
