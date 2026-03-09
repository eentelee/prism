const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

function getPart(parts, type) {
  const part = parts.find((item) => item.type === type);
  return part ? part.value : '';
}

export function isValidTimezone(timezone) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch (error) {
    return false;
  }
}

export function toDateKeyInTimezone(date, timezone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  const parts = formatter.formatToParts(date);
  const year = getPart(parts, 'year');
  const month = getPart(parts, 'month');
  const day = getPart(parts, 'day');
  return `${year}-${month}-${day}`;
}

export function toMonthKeyInTimezone(date, timezone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit'
  });

  const parts = formatter.formatToParts(date);
  const year = getPart(parts, 'year');
  const month = getPart(parts, 'month');
  return `${year}-${month}`;
}

export function isValidDateKey(value) {
  if (!DATE_KEY_RE.test(value)) {
    return false;
  }

  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

export function isValidMonthKey(value) {
  if (!MONTH_KEY_RE.test(value)) {
    return false;
  }

  const [yearText, monthText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);

  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    return false;
  }

  return month >= 1 && month <= 12;
}

export function compareDateKeys(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function daysInMonth(monthKey) {
  const [yearText, monthText] = monthKey.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  return new Date(year, month, 0).getDate();
}

export function buildDateKey(monthKey, day) {
  const dd = String(day).padStart(2, '0');
  return `${monthKey}-${dd}`;
}

function timezoneOffsetMinutes(date, timezone) {
  try {
    const offsetText = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset'
    }).format(date);

    const match = offsetText.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
    if (match) {
      const hours = Number(match[1]);
      const minutes = Number(match[2] || '0');
      const sign = hours < 0 ? -1 : 1;
      return hours * 60 + sign * minutes;
    }
    if (offsetText.includes('GMT') || offsetText.includes('UTC')) {
      return 0;
    }
  } catch (error) {
    // Fall through to part-based offset computation.
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const parts = formatter.formatToParts(date);
  const year = Number(getPart(parts, 'year'));
  const month = Number(getPart(parts, 'month'));
  const day = Number(getPart(parts, 'day'));
  let hour = Number(getPart(parts, 'hour'));
  const minute = Number(getPart(parts, 'minute'));
  const second = Number(getPart(parts, 'second'));

  if (hour === 24) {
    hour = 0;
  }

  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return (asUtc - date.getTime()) / 60000;
}

export function localMidnightUtcMs(dateKey, timezone) {
  if (!isValidDateKey(dateKey)) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }

  const [yearText, monthText, dayText] = dateKey.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  let utcMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0);

  // Offset can change near DST boundaries; iterate to stabilize.
  for (let i = 0; i < 3; i += 1) {
    const offsetMinutes = timezoneOffsetMinutes(new Date(utcMs), timezone);
    utcMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - offsetMinutes * 60000;
  }

  return utcMs;
}

export function elapsedSecondsFromLocalMidnight({
  dateKey,
  timezone,
  nowDate
}) {
  const midnightUtcMs = localMidnightUtcMs(dateKey, timezone);
  const elapsed = Math.floor((nowDate.getTime() - midnightUtcMs) / 1000);
  return Math.max(0, elapsed);
}
