/**
 * Local calendar dates. Deadlines are "all-day" local dates (YYYY-MM-DD) and
 * must never be shifted by time-zone conversion, so all date math here works on
 * plain calendar dates, never on UTC timestamps.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** Today's date on this computer (not UTC). */
export function localDateIso(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Add days to a YYYY-MM-DD date (calendar arithmetic, immune to DST). */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Whole days from `a` to `b` (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Monday-first weeks covering a month, as YYYY-MM-DD (for the month view). */
export function monthGrid(year: number, month: number): string[][] {
  const first = `${year}-${pad(month)}-01`;
  const [y, m] = [year, month];
  const dow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // 0 = Monday
  let cur = addDays(first, -dow);
  const weeks: string[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(cur);
      cur = addDays(cur, 1);
    }
    weeks.push(week);
    if (Number(cur.slice(5, 7)) !== month && w >= 3) break;
  }
  return weeks;
}
