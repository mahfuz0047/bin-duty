// Collection schedule for the Monday P.M. zone, taken from the City of
// Coquitlam calendar (Nov 2026 – Oct 2027), plus the turn rotation maths.

const DAY = 86400000;
const TZ = 'America/Vancouver';

export const FIRST_MONDAY = '2026-11-02';
export const LAST_MONDAY = '2027-10-25';

// Mondays that are holidays: pickup moves to the Tuesday.
const HOLIDAY_MONDAYS = new Set([
  '2027-02-15', '2027-03-29', '2027-05-24', '2027-08-02', '2027-09-06', '2027-10-11',
]);
const YARD_MONDAYS = new Set(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']);
const WEEK_NOTES = { '2026-12-07': 'Battery recycling is collected on Tue, Dec 8.' };

export const BINS = {
  green: 'Green cart',
  garbage: 'Garbage cart',
  recycling: 'Recycling',
  yard: 'Yard trimmings',
};

export const toDate = (iso) => new Date(iso + 'T00:00:00Z');
export const toISO = (d) => d.toISOString().slice(0, 10);
export const addDays = (iso, n) => toISO(new Date(toDate(iso).getTime() + n * DAY));
export const diffDays = (a, b) => Math.round((toDate(a) - toDate(b)) / DAY);

/** Today's date in Coquitlam as YYYY-MM-DD. `?today=YYYY-MM-DD` overrides it for testing. */
export function todayISO() {
  const forced = new URLSearchParams(location.search).get('today');
  if (forced && /^\d{4}-\d{2}-\d{2}$/.test(forced)) return forced;
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

export function mondayOf(iso) {
  const dow = toDate(iso).getUTCDay();
  return addDays(iso, -((dow + 6) % 7));
}

/** What gets collected in the week starting on `monday`. */
export function pickupFor(monday) {
  const weeks = diffDays(monday, FIRST_MONDAY) / 7;
  const holiday = HOLIDAY_MONDAYS.has(monday);
  const bins = ['green'];
  if (((weeks % 2) + 2) % 2 === 0) bins.push('garbage');
  bins.push('recycling');
  if (YARD_MONDAYS.has(monday)) bins.push('yard');
  return {
    monday,
    date: holiday ? addDays(monday, 1) : monday,
    holiday,
    bins,
    note: WEEK_NOTES[monday] || '',
    // Past the end of the printed calendar we continue the pattern but flag it.
    estimated: monday > LAST_MONDAY || monday < FIRST_MONDAY,
  };
}

/**
 * The week the house should be looking at. A week stays current until the day
 * after pickup (so the bins can be brought back in), or until it is fully done.
 */
export function currentMonday(today, isDone = () => false) {
  const monday = mondayOf(today);
  const sincePickup = diffDays(today, pickupFor(monday).date);
  if (sincePickup > 1) return addDays(monday, 7);
  if (sincePickup > 0 && isDone(monday)) return addDays(monday, 7);
  return monday;
}

/** Whose turn it is in `list` for the week starting on `monday`. */
export function assigneeFor(list, monday) {
  const n = list.members.length;
  if (!n) return '';
  const offset = Math.round(diffDays(monday, list.anchor) / 7);
  return list.members[(((list.anchorIndex + offset) % n) + n) % n];
}

export const weekKey = (listId, monday) => `${listId}:${monday}`;

const fmt = (opts) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', ...opts });
const shortFmt = fmt({ weekday: 'short', month: 'short', day: 'numeric' });
const longFmt = fmt({ weekday: 'long', month: 'long', day: 'numeric' });
const stampFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, weekday: 'short', hour: 'numeric', minute: '2-digit',
});

export const fmtShort = (iso) => shortFmt.format(toDate(iso));
export const fmtLong = (iso) => longFmt.format(toDate(iso));
export const fmtStamp = (isoTime) => (isoTime ? stampFmt.format(new Date(isoTime)) : '');

/** "today", "tomorrow", "in 3 days", "yesterday"… relative to `today`. */
export function relative(dateISO, today) {
  const d = diffDays(dateISO, today);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}
