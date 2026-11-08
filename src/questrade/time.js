import { QuestradeError } from './errors.js';

/**
 * Questrade wants ISO 8601 date-times with an offset and works in Eastern
 * time. Tools accept plain dates (YYYY-MM-DD, read as Toronto days) or full
 * date-times with an offset; everything is sent in Toronto local time.
 */
export const ZONE = 'America/Toronto';
const DAY = 86_400_000;

const offsetFormat = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, timeZoneName: 'longOffset' });
const partsFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Offset of Toronto from UTC at an instant, in minutes (e.g. -300). */
export function offsetMinutes(ms) {
  const name = offsetFormat.formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value || 'GMT';
  const m = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/** "2026-01-02T00:00:00-05:00" for an instant, in Toronto local time. */
export function formatQt(ms) {
  const p = Object.fromEntries(partsFormat.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const off = offsetMinutes(ms);
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** Toronto local wall-clock time to an instant. */
function torontoInstant(y, mo, d, h = 0, mi = 0, s = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const first = guess - offsetMinutes(guess) * 60_000;
  return guess - offsetMinutes(first) * 60_000; // second pass settles DST edges
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * Parse a tool's date argument. A plain date means the start of that Toronto
 * day, or its last second when `end` is set.
 */
export function parseBound(value, { end = false, name = 'date' } = {}) {
  if (DATE_RE.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
      throw new QuestradeError(`${name} ${value} is not a real calendar date.`, { code: 'INVALID_ARGUMENT' });
    }
    return end ? torontoInstant(y, m, d, 23, 59, 59) : torontoInstant(y, m, d);
  }
  if (DATETIME_RE.test(value)) return Date.parse(value);
  throw new QuestradeError(`${name} "${value}": use YYYY-MM-DD or an ISO date-time with an offset, e.g. 2026-01-02T09:30:00-05:00.`, { code: 'INVALID_ARGUMENT' });
}

/**
 * Resolve a start/end pair; missing bounds default to the last `defaultDays`
 * days up to now. Refuses inverted or over-long ranges.
 */
export function resolveRange({ startDate, endDate } = {}, { defaultDays = 30, maxDays = 3660, now = Date.now() } = {}) {
  const end = endDate ? parseBound(endDate, { end: true, name: 'endDate' }) : now;
  const start = startDate ? parseBound(startDate, { name: 'startDate' }) : end - defaultDays * DAY;
  if (start > end) throw new QuestradeError(`startDate is after endDate.`, { code: 'INVALID_ARGUMENT' });
  if (end - start > maxDays * DAY) {
    throw new QuestradeError(`The range covers more than ${maxDays} days; narrow it (QUESTRADE_MCP_MAX_RANGE_DAYS raises the cap).`, { code: 'INVALID_ARGUMENT' });
  }
  return { start, end };
}

/** Split [start, end] into back-to-back windows of at most `days` days that do not overlap. */
export function windows(start, end, days = 30) {
  const out = [];
  for (let s = start; s <= end; s += days * DAY) out.push([s, Math.min(end, s + days * DAY - 1000)]);
  return out;
}

/** The date part of a Questrade timestamp (already in Eastern time). */
export const dateOf = (qtTime) => (typeof qtTime === 'string' ? qtTime.slice(0, 10) : undefined);
