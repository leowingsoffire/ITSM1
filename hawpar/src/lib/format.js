/**
 * Formatting helpers shared by the demo engine, extractor and exporters.
 */

const MONTHS = Object.freeze([
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
]);

const MONTH_INDEX = new Map(MONTHS.map((name, index) => [name.toLowerCase(), index]));
const FULL_MONTHS = Object.freeze([
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
]);
FULL_MONTHS.forEach((name, index) => MONTH_INDEX.set(name, index));

/** @param {Date} date @returns {string} e.g. "14 Mar 2026" */
export function formatDate(date) {
  return `${String(date.getUTCDate()).padStart(2, '0')} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** @param {Date} date @returns {string} ISO calendar date (yyyy-mm-dd). */
export function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

export function addMonths(date, months) {
  const copy = new Date(date.getTime());
  const targetMonth = copy.getUTCMonth() + months;
  const day = copy.getUTCDate();
  copy.setUTCDate(1);
  copy.setUTCMonth(targetMonth);
  // Clamp rather than roll over: adding one month to 31 Jan yields 28/29 Feb,
  // which is what lease and licence expiry dates require.
  const lastDayOfMonth = new Date(Date.UTC(copy.getUTCFullYear(), copy.getUTCMonth() + 1, 0)).getUTCDate();
  copy.setUTCDate(Math.min(day, lastDayOfMonth));
  return copy;
}

/**
 * Parses the date formats commonly seen across VGC's supplier base.
 * @param {string} value
 * @returns {Date|null}
 */
export function parseDate(value) {
  if (!value) return null;
  const text = String(value).trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return buildDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const named = /^(\d{1,2})[\s\-/]([A-Za-z]{3,9})[\s\-/](\d{2,4})$/.exec(text);
  if (named) {
    const monthIndex = MONTH_INDEX.get(named[2].toLowerCase());
    if (monthIndex === undefined) return null;
    return buildDate(normaliseYear(Number(named[3])), monthIndex, Number(named[1]));
  }

  const numeric = /^(\d{1,2})[\-/.](\d{1,2})[\-/.](\d{2,4})$/.exec(text);
  if (numeric) {
    return buildDate(normaliseYear(Number(numeric[3])), Number(numeric[2]) - 1, Number(numeric[1]));
  }

  return null;
}

function normaliseYear(year) {
  if (year > 1900) return year;
  return year < 70 ? 2000 + year : 1900 + year;
}

function buildDate(year, monthIndex, day) {
  const date = new Date(Date.UTC(year, monthIndex, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** @param {number} value @returns {string} thousands-separated, 2dp. */
export function formatMoney(value) {
  return Number(value).toLocaleString('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Converts "S$ 1,234.50" / "(1,234.50)" / "1.234,50" into a Number.
 * @param {string|number} value
 * @returns {number|null}
 */
export function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (!value) return null;

  let text = String(value).trim();
  const isNegative = /^\(.*\)$/.test(text) || text.startsWith('-');
  text = text.replace(/[()\-]/g, '');
  text = text.replace(/[A-Za-z$€£¥₹\s]/g, '');
  if (!/\d/.test(text)) return null;

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma > lastDot) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else {
    text = text.replace(/,/g, '');
  }

  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  return isNegative ? -parsed : parsed;
}

/** Masks all but the last four characters — used for PDPA-sensitive identifiers. */
export function maskIdentifier(value) {
  const text = String(value ?? '').replace(/\s+/g, '');
  if (text.length <= 4) return text;
  return `${'*'.repeat(Math.max(4, text.length - 4))}${text.slice(-4)}`;
}

export function titleCase(value) {
  return String(value)
    .toLowerCase()
    .replace(/\b[a-z]/g, (character) => character.toUpperCase());
}
