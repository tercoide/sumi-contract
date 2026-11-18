// Dates without time, as "yyyy-mm-dd" strings (what the files hold). The arithmetic is done in UTC, so the
// computer's time zone and daylight saving never move a day.

export function parseDay(s: string): Date | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(s ?? "").trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCMonth() !== +m[2] - 1) return null; // 2026-02-31
  return d;
}

export function isDay(s: unknown): boolean {
  return typeof s === "string" && parseDay(s) !== null;
}

export function dayString(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function addDays(s: string, n: number): string {
  const d = parseDay(s);
  if (!d) return s;
  d.setUTCDate(d.getUTCDate() + n);
  return dayString(d);
}

/** Days from a to b (b - a) */
export function daysBetween(a: string, b: string): number {
  const x = parseDay(a);
  const y = parseDay(b);
  if (!x || !y) return 0;
  return Math.round((y.getTime() - x.getTime()) / 86400000);
}

/** 1 = Monday ... 7 = Sunday */
export function isoWeekDay(s: string): number {
  const d = parseDay(s);
  if (!d) return 1;
  const w = d.getUTCDay();
  return w === 0 ? 7 : w;
}

/** Today as yyyy-mm-dd, local time */
export function todayDay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
