// Formatting utilities for display

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// Parse "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS" into a UTC Date preserving the
// stored date/time values as-is.  All dates in the DB are already expressed in
// the business timezone, so we must NOT let the JS engine apply any local-
// timezone offset. We create a UTC Date and then format with timeZone:'UTC'.
function parseDateStringAsUTC(dateString: string | null | undefined): Date | null {
  if (!dateString || dateString.trim() === '') {
    return null;
  }

  const datePart = dateString.slice(0, 10);
  const [year, month, day] = datePart.split('-').map(Number);

  // Validate date parts
  if (!year || !month || !day || Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    return null;
  }

  const timePart = dateString.length > 10 ? dateString.slice(11).trim() : '';
  let hour = 0;
  let minute = 0;
  let second = 0;

  if (timePart) {
    const timePieces = timePart.split(':').map(Number);
    hour = timePieces[0] ?? 0;
    minute = timePieces[1] ?? 0;
    second = timePieces[2] ?? 0;
  }

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
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
