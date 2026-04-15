// Formatting utilities for display

export const DEFAULT_BUSINESS_TIMEZONE = 'America/Mexico_City';

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function parseDateOnlyParts(dateString: string): { year: number; month: number; day: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return null;
  }

  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(date.getTime())
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function parseLocalDateTimeParts(dateString: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} | null {
  const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/);
  if (!match) {
    return null;
  }

  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const second = Number(secondStr);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  if (
    Number.isNaN(date.getTime())
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
    || date.getUTCHours() !== hour
    || date.getUTCMinutes() !== minute
    || date.getUTCSeconds() !== second
  ) {
    return null;
  }

  return { year, month, day, hour, minute, second };
}

function isZonedDateTimeString(dateString: string): boolean {
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(dateString);
}

function parseDateString(dateString: string | null | undefined): {
  kind: 'date' | 'localDateTime' | 'zonedDateTime';
  date: Date;
} | null {
  if (!dateString || dateString.trim() === '') {
    return null;
  }

  const trimmed = dateString.trim();

  const dateOnlyParts = parseDateOnlyParts(trimmed);
  if (dateOnlyParts) {
    return { kind: 'date', date: new Date(Date.UTC(dateOnlyParts.year, dateOnlyParts.month - 1, dateOnlyParts.day, 0, 0, 0)) };
  }

  const localDateTimeParts = parseLocalDateTimeParts(trimmed);
  if (localDateTimeParts) {
    return {
      kind: 'localDateTime',
      date: new Date(Date.UTC(
        localDateTimeParts.year,
        localDateTimeParts.month - 1,
        localDateTimeParts.day,
        localDateTimeParts.hour,
        localDateTimeParts.minute,
        localDateTimeParts.second,
      )),
    };
  }

  if (isZonedDateTimeString(trimmed)) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : { kind: 'zonedDateTime', date: parsed };
  }

  return null;
}

function formatPartsInTimeZone(date: Date, timeZone: string, includeTime: boolean): string {
  return new Intl.DateTimeFormat('es-MX', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone,
  }).format(date);
}

export function getBusinessTodayDate(timeZone: string = DEFAULT_BUSINESS_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day') {
      values[part.type] = part.value;
    }
  }

  return `${values.year}-${values.month}-${values.day}`;
}

export function formatDate(dateString: string | null | undefined): string {
  const parsed = parseDateString(dateString);
  if (!parsed) {
    return '-';
  }

  if (parsed.kind === 'zonedDateTime') {
    return formatPartsInTimeZone(parsed.date, DEFAULT_BUSINESS_TIMEZONE, false);
  }

  return formatPartsInTimeZone(parsed.date, 'UTC', false);
}

export function formatDateTime(dateString: string | null | undefined): string {
  const parsed = parseDateString(dateString);
  if (!parsed) {
    return '-';
  }

  if (parsed.kind === 'zonedDateTime') {
    return formatPartsInTimeZone(parsed.date, DEFAULT_BUSINESS_TIMEZONE, true);
  }

  return formatPartsInTimeZone(parsed.date, 'UTC', true);
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
