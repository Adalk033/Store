export const DEFAULT_BUSINESS_TIMEZONE = 'America/Mexico_City';

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseDateString(dateValue: string): { year: number; month: number; day: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    throw new Error('La fecha no tiene un formato valido');
  }

  const [year, month, day] = dateValue.split('-').map(Number);

  if (!isValidDateParts(year, month, day)) {
    throw new Error('La fecha no es valida');
  }

  return { year, month, day };
}

function toDateString(year: number, month: number, day: number): string {
  return `${year}-${padDatePart(month)}-${padDatePart(day)}`;
}

export function resolveBusinessTimeZone(timeZone: string | undefined | null): string {
  if (!timeZone || timeZone.trim() === '') {
    return DEFAULT_BUSINESS_TIMEZONE;
  }

  const normalized = timeZone.trim();

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(new Date());
    return normalized;
  } catch {
    return DEFAULT_BUSINESS_TIMEZONE;
  }
}

export function getDateTimeInTimeZone(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(date);
  const values: Record<string, string> = {};

  for (const part of parts) {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day' || part.type === 'hour' || part.type === 'minute' || part.type === 'second') {
      values[part.type] = part.value;
    }
  }

  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

export function getBusinessNowDateTime(timeZone: string): string {
  return getDateTimeInTimeZone(new Date(), timeZone);
}

export function extractDatePart(dateTimeValue: string): string {
  return dateTimeValue.slice(0, 10);
}

export function getBusinessTodayDate(timeZone: string): string {
  return extractDatePart(getBusinessNowDateTime(timeZone));
}

export function addDaysToDate(dateValue: string, days: number): string {
  const { year, month, day } = parseDateString(dateValue);
  const baseDate = new Date(Date.UTC(year, month - 1, day));
  baseDate.setUTCDate(baseDate.getUTCDate() + days);

  return toDateString(
    baseDate.getUTCFullYear(),
    baseDate.getUTCMonth() + 1,
    baseDate.getUTCDate()
  );
}
